/**
 * Send the comeback email ("Still want to give MastersFit a try?") to named
 * recipients.
 *
 *   Preview:  npm run send-comeback -- --preview you@example.com [--days 19]
 *   Dry run:  npm run send-comeback -- a@example.com b@example.com
 *   Send:     npm run send-comeback -- a@example.com b@example.com --send
 *
 * For people who finished setup, got a plan, never logged a set, and whose plan
 * has since expired. NOT the activation nudge's audience any more — that email
 * says "your session is ready", and for everyone here that stopped being true
 * days or weeks ago.
 *
 * Same two deliberate departures as send-feature-tour, for the same reason (a
 * sent email cannot be undone): it takes EXPLICIT addresses rather than scanning
 * for candidates, and it DRY RUNS by default, needing --send to mail anyone.
 *
 * Refuses to run from a checkout behind origin/main: the email is rendered and
 * sent by THIS directory, not by Render, so stale code here sends a stale email
 * while looking entirely successful. --stale-ok overrides.
 */
// MUST come before the emailService import: that module constructs the Resend
// client at load time, so the key has to be in process.env first.
import "dotenv/config";

import { eq, and, isNull } from "drizzle-orm";

import { db, pool } from "@/config/database";
import {
  companyPostalAddress,
  isSuppressedNudgeEmail,
} from "@/constants/activation-nudge";
import { users } from "@/models/user.schema";
import { emailService } from "@/services/email.service";

import { assertCheckoutIsCurrent } from "./lib/checkout-freshness";

/** A user id that cannot exist, so a preview's unsubscribe token is inert. */
const INERT_USER_ID = 0;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

type Outcome =
  | "sent"
  | "would-send"
  | "no-user"
  | "suppressed"
  | "opted-out"
  | "already-sent"
  | "send-failed";

/**
 * Resolve one address and, when actually sending, claim it.
 *
 * The claim is an atomic conditional UPDATE (`WHERE comeback_sent_at IS
 * NULL`) taken BEFORE the send, not after. Two copies of this script run at
 * once would otherwise both read null and both mail the same person. Claiming
 * first means the worst case is an unsent claim — someone who misses an email —
 * rather than a customer getting it twice.
 */
async function handle(
  email: string,
  send: boolean,
  postalAddress: string,
): Promise<Outcome> {
  const normalized = email.trim().toLowerCase();

  // Checked before the lookup: the suppression list is the one rule that should
  // hold even if the address somehow resolves to a real row.
  if (isSuppressedNudgeEmail(normalized)) {
    console.log(`  ${normalized}: SUPPRESSED (internal/protected account)`);
    return "suppressed";
  }

  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      optedOutAt: users.emailOptedOutAt,
      sentAt: users.comebackSentAt,
    })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  if (!u) {
    console.log(`  ${normalized}: NO USER — nothing to do`);
    return "no-user";
  }
  if (u.optedOutAt) {
    console.log(
      `  ${normalized}: OPTED OUT on ${u.optedOutAt.toISOString().slice(0, 10)} — skipping`,
    );
    return "opted-out";
  }
  if (u.sentAt) {
    console.log(
      `  ${normalized}: ALREADY SENT on ${u.sentAt.toISOString().slice(0, 10)} — skipping`,
    );
    return "already-sent";
  }

  if (!send) {
    console.log(`  ${normalized}: would send (user ${u.id}, "${u.name}")`);
    return "would-send";
  }

  const claimed = await db
    .update(users)
    .set({ comebackSentAt: new Date() })
    .where(and(eq(users.id, u.id), isNull(users.comebackSentAt)))
    .returning({ id: users.id });

  if (claimed.length === 0) {
    console.log(`  ${normalized}: claimed by another run — skipping`);
    return "already-sent";
  }

  try {
    // Resolved per recipient: this cohort spans 8 days since signup to 289, and
    // one wrong "a few weeks back" is what makes a personal note read as a blast.
    const daysSinceSignup = u.createdAt
      ? Math.max(
          0,
          Math.floor((Date.now() - u.createdAt.getTime()) / 86_400_000),
        )
      : 0;

    await emailService.sendComebackEmail({
      to: u.email,
      name: u.name,
      userId: u.id,
      daysSinceSignup,
      postalAddress,
    });
    console.log(`  ${normalized}: SENT (user ${u.id})`);
    return "sent";
  } catch (error) {
    // Release the claim so a retry is possible. A stamped column with no email
    // behind it is the one state that silently loses a recipient forever.
    await db
      .update(users)
      .set({ comebackSentAt: null })
      .where(eq(users.id, u.id));
    console.error(
      `  ${normalized}: SEND FAILED — ${error instanceof Error ? error.message : error}`,
    );
    return "send-failed";
  }
}

async function main() {
  const send = flag("send");
  const previewTo = arg("preview");

  // The footer address is a hard compliance gate. Required in both modes, so a
  // preview shows exactly what a recipient would get rather than a placeholder
  // that hides a misconfiguration.
  const postalAddress = companyPostalAddress();
  if (!postalAddress) {
    console.error(
      "COMPANY_POSTAL_ADDRESS is not set.\n" +
        "Commercial email must carry a physical address, and this script refuses\n" +
        "to send without one. It lives in Render for the scheduled jobs; set it\n" +
        "in your local .env to run this from here.\n",
    );
    process.exit(1);
  }

  // ── Preview: one real email, no database reads or writes ──
  if (previewTo) {
    await assertCheckoutIsCurrent({
      label: "npm run send-comeback -- --preview",
      skip: flag("stale-ok"),
      // A preview mails only the address you typed, so a stale render is worth
      // knowing about but never worth blocking on.
      warnOnly: true,
      effect: "send a preview email",
    });
    console.log(`Sending comeback preview to ${previewTo}`);
    console.log("  (no database writes; the unsubscribe link is inert)\n");
    await emailService.sendComebackEmail({
      to: previewTo,
      name: arg("name") ?? "Chris",
      // Overridable so every branch of signupPhrase() can be previewed.
      daysSinceSignup: Number(arg("days") ?? 19),
      userId: INERT_USER_ID,
      postalAddress,
    });
    console.log("Sent.");
    return;
  }

  const emails = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--") && a.includes("@"));

  if (emails.length === 0) {
    console.error(
      "usage:\n" +
        "  npm run send-comeback -- --preview you@example.com\n" +
        "  npm run send-comeback -- a@example.com b@example.com          (dry run)\n" +
        "  npm run send-comeback -- a@example.com b@example.com --send   (sends)\n",
    );
    process.exit(1);
  }

  await assertCheckoutIsCurrent({
    label: "npm run send-comeback",
    skip: flag("stale-ok"),
    // A dry run touches nothing, so warn; a real send is blocked outright.
    warnOnly: !send,
    effect: send
      ? "email customers and stamp comeback_sent_at"
      : "report who would be emailed",
  });

  console.log(
    `\nfeature tour — ${emails.length} address(es) — ${send ? "SENDING" : "DRY RUN"}\n`,
  );

  const counts: Record<string, number> = {};
  for (const email of emails) {
    const outcome = await handle(email, send, postalAddress);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }

  console.log(`\n${send ? "done" : "dry run complete"}:`, counts);
  if (!send) {
    console.log("\nNothing was sent. Re-run with --send to actually mail these.\n");
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });

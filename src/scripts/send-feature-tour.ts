/**
 * Send the feature-tour email ("A few MastersFit features you may have missed")
 * to named recipients.
 *
 *   Preview:  npm run send-feature-tour -- --preview you@example.com
 *   Dry run:  npm run send-feature-tour -- a@example.com b@example.com
 *   Send:     npm run send-feature-tour -- a@example.com b@example.com --send
 *
 * WHY THIS TAKES EXPLICIT EMAILS, and does not scan for candidates the way the
 * two nudge jobs do: those run unattended on a schedule and must therefore
 * decide for themselves who qualifies. This is a one-off to a named handful of
 * people, and inventing scan criteria for it would mean a query whose blast
 * radius nobody has checked. Typing the addresses IS the safety property.
 *
 * WHY --send RATHER THAN --dry-run: every other ops script here defaults to
 * applying and takes --dry-run to hold back, because their writes are
 * reversible (a comp is one nullable column). A sent email is not reversible by
 * anything, so this one inverts the default. Without --send it reports and
 * exits.
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
 * The claim is an atomic conditional UPDATE (`WHERE feature_tour_sent_at IS
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
      optedOutAt: users.emailOptedOutAt,
      sentAt: users.featureTourSentAt,
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
    .set({ featureTourSentAt: new Date() })
    .where(and(eq(users.id, u.id), isNull(users.featureTourSentAt)))
    .returning({ id: users.id });

  if (claimed.length === 0) {
    console.log(`  ${normalized}: claimed by another run — skipping`);
    return "already-sent";
  }

  try {
    await emailService.sendFeatureTourEmail({
      to: u.email,
      name: u.name,
      userId: u.id,
      postalAddress,
    });
    console.log(`  ${normalized}: SENT (user ${u.id})`);
    return "sent";
  } catch (error) {
    // Release the claim so a retry is possible. A stamped column with no email
    // behind it is the one state that silently loses a recipient forever.
    await db
      .update(users)
      .set({ featureTourSentAt: null })
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
      label: "npm run send-feature-tour -- --preview",
      skip: flag("stale-ok"),
      // A preview mails only the address you typed, so a stale render is worth
      // knowing about but never worth blocking on.
      warnOnly: true,
      effect: "send a preview email",
    });
    console.log(`Sending feature-tour preview to ${previewTo}`);
    console.log("  (no database writes; the unsubscribe link is inert)\n");
    await emailService.sendFeatureTourEmail({
      to: previewTo,
      name: arg("name") ?? "Kelly",
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
        "  npm run send-feature-tour -- --preview you@example.com\n" +
        "  npm run send-feature-tour -- a@example.com b@example.com          (dry run)\n" +
        "  npm run send-feature-tour -- a@example.com b@example.com --send   (sends)\n",
    );
    process.exit(1);
  }

  await assertCheckoutIsCurrent({
    label: "npm run send-feature-tour",
    skip: flag("stale-ok"),
    // A dry run touches nothing, so warn; a real send is blocked outright.
    warnOnly: !send,
    effect: send
      ? "email customers and stamp feature_tour_sent_at"
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

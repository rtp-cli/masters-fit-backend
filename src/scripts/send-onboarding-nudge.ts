/**
 * Manual control for the onboarding nudge — the "you never finished setting up"
 * email.
 *
 * Three modes:
 *
 *   1. TEST SEND — render the email from sample data and send it to an address
 *      you name. Touches NO database rows and claims nothing. Use it to see the
 *      email in a real inbox.
 *
 *        npm run send-onboarding-nudge -- --to you@example.com
 *
 *   2. DRY RUN — show exactly who today's scan WOULD nudge, and send nothing.
 *      Reads the database, writes nothing.
 *
 *        npm run send-onboarding-nudge -- --dry-run
 *
 *   3. RUN FOR REAL — the same thing the daily cron does. Claims and sends.
 *
 *        npm run send-onboarding-nudge -- --run
 *
 * Sending modes need ONBOARDING_NUDGE_ENABLED=true, exactly like production —
 * the kill switch is not bypassed here on purpose.
 */
// Load .env before importing email.service — it builds the Resend client at
// module load, which needs RESEND_API_KEY present. (ESM runs imports top-down.)
import "dotenv/config";
import { emailService } from "@/services/email.service";
import { onboardingNudgeService } from "@/services/onboarding-nudge.service";
import { runOnboardingNudge } from "@/jobs/onboarding-nudge.job";
import {
  isOnboardingNudgeEnabled,
  companyPostalAddress,
  onboardingContinueUrl,
  onboardingNudgeMinHours,
  onboardingNudgeMaxDays,
} from "@/constants/onboarding-nudge";
import { getCurrentUTCDate } from "@/utils/date.utils";
import { pool } from "@/config/database";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requireEnabled() {
  if (!isOnboardingNudgeEnabled()) {
    console.error(
      "ONBOARDING_NUDGE_ENABLED is not 'true' — refusing to send.\n" +
        "Set it in your environment to match how production runs:\n" +
        "  ONBOARDING_NUDGE_ENABLED=true npm run send-onboarding-nudge -- ..."
    );
    process.exit(1);
  }
}

function host(): string {
  return process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
}

async function testSend(to: string, userId?: number) {
  requireEnabled();

  // A test send is a preview, so it must not be blocked by the compliance gate
  // that (correctly) stops the real job. Make the placeholder impossible to
  // mistake for the real thing if it ever lands in a customer's inbox.
  const address =
    companyPostalAddress() ?? "[COMPANY_POSTAL_ADDRESS is not set — TEST SEND]";
  if (!companyPostalAddress()) {
    console.warn(
      "\n  ⚠ COMPANY_POSTAL_ADDRESS is not set. Sending with a placeholder footer.\n" +
        "    The real job REFUSES to send without it — this preview is the only exception.\n"
    );
  }

  // With --user, render from that person's REAL row so you see exactly what
  // they would receive. Still sends to the address you named, and still claims
  // nothing — this is a preview of their email, not their email.
  let name = "Charlie";
  if (userId !== undefined) {
    const candidate = await onboardingNudgeService.getCandidateById(
      userId,
      getCurrentUTCDate()
    );
    if (!candidate) {
      console.error(
        `  No user ${userId}, or they have opted out. Nothing sent.\n`
      );
      process.exit(1);
    }
    name = candidate.name;
    console.log(`\n  rendering from user ${userId}: ${candidate.email} (${candidate.name}, stalled ${candidate.stalledDays}d)`);
  }

  console.log(`\nsend-onboarding-nudge — TEST SEND`);
  console.log(`  to           : ${to}`);
  console.log(`  continue url : ${onboardingContinueUrl()}`);
  console.log(`  no database rows are touched\n`);

  // userId 0 signs a token that resolves to no user, so clicking unsubscribe in
  // the preview shows the failure page instead of opting a real person out —
  // including when previewing a real person's email.
  await emailService.sendOnboardingNudgeEmail({
    to,
    name,
    userId: 0,
    postalAddress: address,
  });

  console.log("  ✓ sent\n");
}

async function dryRun() {
  const now = getCurrentUTCDate();
  const candidates = await onboardingNudgeService.getNudgeCandidates(now);

  console.log(`\nsend-onboarding-nudge — DRY RUN (db host: ${host()})`);
  console.log(
    `  window: signed up between ${onboardingNudgeMaxDays()} days and ${onboardingNudgeMinHours()} hours ago`
  );
  console.log(`  enabled: ${isOnboardingNudgeEnabled()}`);
  console.log(`  postal address set: ${Boolean(companyPostalAddress())}\n`);

  if (!candidates.length) {
    console.log("  Nobody is eligible right now.\n");
    return;
  }

  console.log(`  ${candidates.length} would be nudged:`);
  for (const c of candidates) {
    console.log(
      `    • ${c.email}  (${c.name}, user ${c.userId}, stalled ${c.stalledDays}d)`
    );
  }
  console.log("");
}

/**
 * Really nudge ONE named person, now, ignoring the timing window.
 *
 * Claims and writes exactly like the daily job, so it can never double-send:
 * if they have already been nudged the claim fails and this reports it.
 */
async function dispatchOne(userId: number) {
  requireEnabled();

  const candidate = await onboardingNudgeService.getCandidateById(
    userId,
    getCurrentUTCDate()
  );
  if (!candidate) {
    console.error(`\n  No user ${userId}, or they have opted out. Nothing sent.\n`);
    process.exitCode = 1;
    return;
  }

  // --dispatch ignores the TIMING window on purpose. It must not ignore
  // whether the nudge is true: "you never finished setting up" aimed at
  // somebody who finished is the worst email this feature can send.
  if (!candidate.needsOnboarding) {
    console.error(
      `\n  User ${userId} (${candidate.email}) has already finished onboarding.\n` +
        `  Refusing to send them a "you never finished" email.\n`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nsend-onboarding-nudge — DISPATCH (db host: ${host()})`);
  console.log(`  user ${userId}: ${candidate.email} (${candidate.name})`);
  console.log(`  THIS SENDS A REAL EMAIL TO THEM.\n`);

  const outcome = await onboardingNudgeService.sendNudge(candidate);
  console.log(`  outcome: ${outcome}\n`);
  if (outcome !== "sent") process.exitCode = 1;
}

async function runForReal() {
  requireEnabled();
  console.log(`\nsend-onboarding-nudge — REAL RUN (db host: ${host()})\n`);
  const result = await runOnboardingNudge();
  console.log(`  ${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const to = arg("to");
  const userRaw = arg("user");
  const dispatchRaw = arg("dispatch");

  if (to) return testSend(to, userRaw ? Number(userRaw) : undefined);
  if (dispatchRaw) return dispatchOne(Number(dispatchRaw));
  if (flag("dry-run")) return dryRun();
  if (flag("run")) return runForReal();

  console.error(
    "Usage:\n" +
      "  --to <email>              test send from sample data (no db writes)\n" +
      "  --to <email> --user <id>  preview a REAL user's nudge, sent to you (no db writes)\n" +
      "  --dry-run                 show who would be nudged\n" +
      "  --dispatch <id>           really nudge one person now, window ignored\n" +
      "  --run                     run the full scan for real"
  );
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });

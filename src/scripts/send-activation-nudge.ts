/**
 * Preview the activation nudge by delivering one real email.
 *
 *   npm run send-activation-nudge -- --to you@example.com
 *   npm run send-activation-nudge -- --to you@example.com --session "Upper Body HIIT"
 *
 * TEST SEND ONLY. This deliberately does NOT touch the database: it claims
 * nothing, marks nothing as sent, and reads no candidates. It exists so the
 * copy and rendering can be checked in a real inbox before the scheduled job is
 * ever allowed to mail a customer.
 *
 * Two safety notes:
 *  - Suppression is BYPASSED on purpose. The owner's own address is in
 *    PROTECTED_EMAILS, so a suppression-respecting preview could never reach
 *    him. That is safe here precisely because nothing is persisted.
 *  - The unsubscribe link is signed for a NON-EXISTENT user id, so clicking it
 *    in the preview cannot opt a real account out of anything. Testing that the
 *    unsubscribe flow works is a separate exercise against a real id.
 */
// MUST come before the emailService import: that module constructs the Resend
// client at load time, so the key has to be in process.env first.
import "dotenv/config";

import { emailService } from "@/services/email.service";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// A user id that cannot exist, so the signed unsubscribe token is inert.
const INERT_USER_ID = 0;

async function main() {
  const to = arg("to");
  if (!to) {
    console.error(
      "usage:\n  npm run send-activation-nudge -- --to you@example.com " +
        "[--name N] [--plan 'Plan name'] [--session 'Session name']\n"
    );
    process.exit(1);
  }

  // The footer address is a hard compliance gate in the real job. Require it
  // here too so the preview shows exactly what a recipient would get, rather
  // than a placeholder that hides a misconfiguration.
  if (!process.env.COMPANY_POSTAL_ADDRESS?.trim()) {
    console.error(
      "COMPANY_POSTAL_ADDRESS is not set. The real job refuses to send without\n" +
        "it, so a preview without it would be misleading. Set it (it is in\n" +
        "Render for the live job) and re-run.\n"
    );
    process.exit(1);
  }

  const name = arg("name") ?? "Charlie";
  const planName = arg("plan") ?? "Strength + HIIT Fat Loss Split";
  const firstSessionName = arg("session") ?? "Upper Body Strength + HIIT";

  console.log(`Sending activation nudge preview to ${to} ...`);
  console.log(`  name:    ${name}`);
  console.log(`  plan:    ${planName}`);
  console.log(`  session: ${firstSessionName}`);
  console.log(`  (no database writes; unsubscribe link is inert)\n`);

  await emailService.sendActivationNudgeEmail({
    to,
    name,
    userId: INERT_USER_ID,
    planName,
    firstSessionName,
    postalAddress: process.env.COMPANY_POSTAL_ADDRESS.trim(),
  });

  console.log("Sent.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

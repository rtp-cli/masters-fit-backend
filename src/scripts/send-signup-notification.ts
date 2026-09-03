/**
 * Manual trigger for the two internal signup notifications.
 *
 * Four modes:
 *
 *   1. TEST SEND (default) — render one of the emails from sample data and send
 *      it to an address you name. Touches NO database rows. Use it to see the
 *      email in a real inbox.
 *
 *        npm run send-signup-notification -- --to you@example.com
 *        npm run send-signup-notification -- --to you@example.com --digest
 *
 *   2. PREVIEW ONE REAL USER — render the new-user alert from a real account's
 *      data and send it. Reads the database, writes nothing (no claim taken).
 *
 *        npm run send-signup-notification -- --to you@example.com --user 148
 *
 *   3. DISPATCH FOR REAL — the same thing onboarding completion does: claim and
 *      send this user's alert once. Writes signup_notified_at.
 *
 *        npm run send-signup-notification -- --dispatch 148
 *
 *   4. RUN THE DIGEST SCAN NOW — the same thing the daily cron does: build the
 *      stalled list and email it if anyone is new. Writes
 *      stalled_digest_notified_at. Also useful with --dry-run to just see the list.
 *
 *        npm run send-signup-notification -- --run-digest --dry-run
 *        npm run send-signup-notification -- --run-digest
 *
 * All sending modes need SIGNUP_NOTIFY_ENABLED=true in the environment, exactly
 * like production — the kill switch is not bypassed here on purpose.
 */
// Load .env before importing email.service — it builds the Resend client at
// module load, which needs RESEND_API_KEY present. (ESM runs imports top-down.)
import "dotenv/config";
import { emailService } from "@/services/email.service";
import {
  signupNotificationService,
  buildProfileRows,
  formatRelativeAge,
  formatClockTime,
  formatShortDate,
} from "@/services/signup-notification.service";
import { runStalledSignupDigest } from "@/jobs/stalled-signup-digest.job";
import { isSignupNotifyEnabled } from "@/constants/signup-notifications";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requireEnabled() {
  if (!isSignupNotifyEnabled()) {
    console.error(
      "SIGNUP_NOTIFY_ENABLED is not 'true' — refusing to send.\n" +
        "Set it in your environment to match how production runs:\n" +
        "  SIGNUP_NOTIFY_ENABLED=true npm run send-signup-notification -- ..."
    );
    process.exit(1);
  }
}

/** Overrides the configured recipient for a one-off test send. */
function withRecipient<T>(to: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.SIGNUP_NOTIFY_EMAIL;
  process.env.SIGNUP_NOTIFY_EMAIL = to;
  return fn().finally(() => {
    if (previous === undefined) delete process.env.SIGNUP_NOTIFY_EMAIL;
    else process.env.SIGNUP_NOTIFY_EMAIL = previous;
  });
}

async function testSendNewUser(to: string) {
  const now = new Date();
  await withRecipient(to, () =>
    emailService.sendNewUserNotificationEmail({
      userId: 148,
      name: "Jane Doe",
      email: "jane.doe@example.com",
      signedUpAgo: "6 minutes ago",
      completedAt: formatClockTime(now),
      subscriptionStatus: "trial",
      profileRows: [
        { label: "Profile", value: "54 · female · intermediate" },
        { label: "Goals", value: "Strength, Mobility" },
        { label: "Schedule", value: "4 days a week · 45 minutes" },
        { label: "Training at", value: "Home gym — Dumbbells, Bands, Bench" },
        { label: "Limitations", value: "Lower back" },
      ],
      compCommand: "npm run comp-user -- jane.doe@example.com",
    })
  );
  console.log(`Sent sample new-user alert to ${to}`);
}

async function testSendDigest(to: string) {
  await withRecipient(to, () =>
    emailService.sendStalledSignupDigestEmail({
      // No name on purpose: these people have no account, and a name is only
      // collected on the screen after a code is verified.
      neverSignedIn: [
        {
          email: "tom.reilly@exmaple.com",
          stalledLabel: "Stalled 5 days",
          metaLine: "Code sent Sep 2 · never entered a code",
          isNew: true,
        },
        {
          email: "dana.k@example.com",
          stalledLabel: "Stalled 3 days",
          metaLine:
            "Code sent Sep 4 · 3 codes, last Sep 5 · entered a wrong code 2 times",
          isNew: true,
        },
      ],
      signedInNoProfile: [
        {
          name: "Marcus Webb",
          email: "marcus.webb@example.com",
          stalledLabel: "Stalled 6 days",
          metaLine: "Signed up Sep 1 · last signed in Sep 1 · hasn't been back",
          isNew: false,
        },
        {
          name: "Priya Nadkarni",
          email: "priya.n@example.com",
          stalledLabel: "Stalled 3 days",
          metaLine: "Signed up Sep 4 · last signed in Sep 5 · came back since",
          isNew: true,
        },
      ],
      newCount: 3,
      totalCount: 4,
      signupsLast7Days: 11,
      finishedLast7Days: 8,
    })
  );
  console.log(`Sent sample stalled-signup digest to ${to}`);
}

async function previewRealUser(to: string, userId: number) {
  const snapshot = await signupNotificationService.getNewUserSnapshot(userId);
  if (!snapshot) {
    console.error(`No user with id ${userId}`);
    process.exit(1);
  }

  await withRecipient(to, () =>
    emailService.sendNewUserNotificationEmail({
      userId: snapshot.userId,
      name: snapshot.name,
      email: snapshot.email,
      signedUpAgo: formatRelativeAge(snapshot.createdAt, snapshot.completedAt),
      completedAt: formatClockTime(snapshot.completedAt),
      subscriptionStatus: snapshot.subscriptionStatus,
      profileRows: buildProfileRows(snapshot),
      compCommand: `npm run comp-user -- ${snapshot.email}`,
    })
  );
  console.log(`Sent user #${userId} (${snapshot.email}) preview to ${to} — no rows written`);
}

async function dispatchForUser(userId: number) {
  const outcome = await signupNotificationService.dispatchNewUserAlert(userId);
  console.log(`Dispatch outcome for user #${userId}: ${outcome}`);
  if (outcome === "already-sent") {
    console.log(
      "This user's alert was already claimed. To resend, clear the claim:\n" +
        `  update users set signup_notified_at = null where id = ${userId};`
    );
  }
}

async function showDigestList() {
  const report = await signupNotificationService.getStalledSignupReport(new Date());

  const total = report.stalled.length + report.stalledSignIns.length;
  const newCount =
    report.newlyStalled.length + report.newlyStalledSignIns.length;

  console.log(
    `\nStalled: ${total} (${newCount} new)` +
      ` · signups 7d: ${report.signupsLast7Days} · finished 7d: ${report.finishedLast7Days}\n`
  );

  if (total === 0) {
    console.log("Nobody is stalled right now.");
    return;
  }

  if (report.stalledSignIns.length > 0) {
    console.log("  NEVER FINISHED SIGN-IN (no account, no name):");
    for (const p of report.stalledSignIns) {
      console.log(
        `  ${p.isNewToDigest ? "NEW " : "    "}${p.email}` +
          ` · ${p.stalledDays}d · ${p.codesSent} code(s) · ${p.failedAttempts} failed attempt(s)`
      );
    }
    console.log("");
  }

  if (report.stalled.length > 0) {
    console.log("  ACCOUNT EXISTS, ONBOARDING UNFINISHED:");
    for (const p of report.stalled) {
      const lastSeen = p.lastSignInAt ? formatShortDate(p.lastSignInAt) : "—";
      console.log(
        `  ${p.isNewToDigest ? "NEW " : "    "}#${p.userId} ${p.email}` +
          ` · ${p.stalledDays}d · ${p.hasSignedIn ? "signed-in" : "NEVER signed in"}` +
          ` · last sign-in ${lastSeen}`
      );
    }
  }

  console.log(
    report.hasAnythingNew
      ? `\nA real run would SEND (${newCount} new).`
      : "\nA real run would send NOTHING (nobody new)."
  );
}

async function main() {
  const to = arg("to");
  const userArg = arg("user");
  const dispatchArg = arg("dispatch");

  if (flag("run-digest")) {
    if (flag("dry-run")) {
      await showDigestList();
      return;
    }
    requireEnabled();
    const result = await runStalledSignupDigest(new Date());
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (dispatchArg) {
    requireEnabled();
    await dispatchForUser(Number(dispatchArg));
    return;
  }

  if (!to) {
    console.error(
      "Usage:\n" +
        "  --to <email>                 send a sample new-user alert\n" +
        "  --to <email> --digest        send a sample stalled-signup digest\n" +
        "  --to <email> --user <id>     render a real user's alert (no writes)\n" +
        "  --dispatch <id>              claim + send for real\n" +
        "  --run-digest [--dry-run]     run the daily digest scan now"
    );
    process.exit(1);
  }

  requireEnabled();

  if (userArg) await previewRealUser(to, Number(userArg));
  else if (flag("digest")) await testSendDigest(to);
  else await testSendNewUser(to);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

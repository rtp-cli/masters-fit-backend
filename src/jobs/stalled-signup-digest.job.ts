import { Job } from "bull";
import { logger } from "@/utils/logger";
import { emailService } from "@/services/email.service";
import {
  signupNotificationService,
  formatShortDate,
  type StalledSignup,
  type StalledSignIn,
} from "@/services/signup-notification.service";
import type { StalledPersonRow } from "@/templates/stalled-signup-digest-email";
import { isSignupNotifyEnabled } from "@/constants/signup-notifications";

export interface StalledSignupDigestResult {
  /** Everyone currently on the worklist, across both groups. */
  stalled: number;
  /** How many of those had never been reported before. */
  newlyStalled: number;
  /** Addresses that never completed a sign-in (no account exists). */
  stalledSignIns: number;
  /** New-user alerts recovered by the sweep (failed sends from the last 48h). */
  alertsRecovered: number;
  sent: boolean;
  /** Why nothing was sent, when nothing was sent. */
  reason?: "disabled" | "nothing-new" | "send-failed";
}

function toRow(person: StalledSignup): StalledPersonRow {
  const parts = [`Signed up ${formatShortDate(person.createdAt)}`];

  if (!person.hasSignedIn) {
    parts.push("account created, never signed in");
  } else if (person.lastSignInAt) {
    parts.push(`last signed in ${formatShortDate(person.lastSignInAt)}`);
    // Signing in again after the day they joined means they came back and
    // still didn't finish — a different kind of stuck than never returning.
    const sameDay =
      formatShortDate(person.lastSignInAt) === formatShortDate(person.createdAt);
    parts.push(sameDay ? "hasn't been back" : "came back since");
  }

  return {
    name: person.name,
    email: person.email,
    stalledLabel: `Stalled ${person.stalledDays} day${person.stalledDays === 1 ? "" : "s"}`,
    metaLine: parts.join(" · "),
    isNew: person.isNewToDigest,
  };
}

/**
 * A row for someone with no account. There is no name to show — the app only
 * asks for one after a code is verified — so the meta line carries what we do
 * know: when we mailed them, how many times, and whether a code was ever
 * actually typed in (failed attempts) versus ignored outright.
 */
function signInToRow(attempt: StalledSignIn): StalledPersonRow {
  const parts = [`Code sent ${formatShortDate(attempt.firstCodeSentAt)}`];

  if (attempt.codesSent > 1) {
    parts.push(
      `${attempt.codesSent} codes, last ${formatShortDate(attempt.lastCodeSentAt)}`
    );
  }

  parts.push(
    attempt.failedAttempts > 0
      ? `entered a wrong code ${attempt.failedAttempts} time${attempt.failedAttempts === 1 ? "" : "s"}`
      : "never entered a code"
  );

  return {
    email: attempt.email,
    stalledLabel: `Stalled ${attempt.stalledDays} day${attempt.stalledDays === 1 ? "" : "s"}`,
    metaLine: parts.join(" · "),
    isNew: attempt.isNewToDigest,
  };
}

/**
 * Find everyone who signed up and never finished onboarding, and email the list
 * — but ONLY when at least one of them is new since the last digest. A daily
 * cadence that re-sent the same names every morning would be noise; gating on
 * arrivals means the email always carries something you haven't seen, while
 * still showing the full open worklist for context.
 *
 * Nobody is marked as reported until the send succeeds, so a Resend outage
 * means tomorrow's run treats today's arrivals as new and tries again.
 *
 * Exported so it can be invoked directly (tests / manual trigger) without Bull.
 */
export async function runStalledSignupDigest(
  now: Date
): Promise<StalledSignupDigestResult> {
  if (!isSignupNotifyEnabled()) {
    return {
      stalled: 0,
      newlyStalled: 0,
      stalledSignIns: 0,
      alertsRecovered: 0,
      sent: false,
      reason: "disabled",
    };
  }

  // Sweep first: users who finished onboarding but whose alert send failed
  // (claim was released). dispatchNewUserAlert re-checks suppression and takes
  // the atomic claim, so racing an in-flight completion is harmless.
  const alertsRecovered = await sweepMissedNewUserAlerts(now);

  const report = await signupNotificationService.getStalledSignupReport(now);

  const base = {
    stalled: report.stalled.length + report.stalledSignIns.length,
    newlyStalled: report.newlyStalled.length + report.newlyStalledSignIns.length,
    stalledSignIns: report.stalledSignIns.length,
    alertsRecovered,
  };

  // The gate: nobody new in EITHER group, no email.
  if (!report.hasAnythingNew) {
    logger.info("Stalled signup digest skipped — nothing new", {
      operation: "runStalledSignupDigest",
      metadata: base,
    });
    return { ...base, sent: false, reason: "nothing-new" };
  }

  try {
    await emailService.sendStalledSignupDigestEmail({
      // Group A = nobody ever completed a sign-in. Two sources feed it:
      // addresses with no account at all (auth_codes), plus the rare account
      // with no session — the legacy pre-verify /signup path an old client can
      // still hit. Those DO have a name, so the row shows one.
      neverSignedIn: [
        ...report.stalledSignIns.map(signInToRow),
        ...report.stalled.filter((p) => !p.hasSignedIn).map(toRow),
      ],
      // Group B = an account with at least one session, onboarding unfinished.
      signedInNoProfile: report.stalled.filter((p) => p.hasSignedIn).map(toRow),
      newCount: base.newlyStalled,
      totalCount: base.stalled,
      signupsLast7Days: report.signupsLast7Days,
      finishedLast7Days: report.finishedLast7Days,
    });
  } catch (error) {
    // Mark nobody — tomorrow's run sees the same arrivals as new and retries.
    logger.error("Failed to send stalled signup digest", error as Error, {
      operation: "runStalledSignupDigest",
      metadata: base,
    });
    return { ...base, sent: false, reason: "send-failed" };
  }

  await Promise.all([
    signupNotificationService.markStalledDigestNotified(
      report.newlyStalled.map((p) => p.userId),
      now
    ),
    signupNotificationService.markStalledSignInsReported(
      report.newlyStalledSignIns.map((p) => p.email),
      now
    ),
  ]);

  logger.info("Stalled signup digest sent", {
    operation: "runStalledSignupDigest",
    metadata: base,
  });

  return { ...base, sent: true };
}

/**
 * Retry consumer for released new-user-alert claims: a completed onboarding
 * whose alert send failed would otherwise be lost forever — the digest only
 * looks at users who did NOT finish. Returns how many alerts were sent.
 */
async function sweepMissedNewUserAlerts(now: Date): Promise<number> {
  try {
    const userIds =
      await signupNotificationService.getUnnotifiedCompletedSignups(now);

    let recovered = 0;
    for (const userId of userIds) {
      const outcome = await signupNotificationService.dispatchNewUserAlert(userId);
      if (outcome === "sent") recovered++;
    }

    if (recovered > 0) {
      logger.info("Recovered missed new-user alerts", {
        operation: "sweepMissedNewUserAlerts",
        metadata: { candidates: userIds.length, recovered },
      });
    }
    return recovered;
  } catch (error) {
    // The digest must still run if the sweep query fails.
    logger.error("New-user alert sweep failed", error as Error, {
      operation: "sweepMissedNewUserAlerts",
    });
    return 0;
  }
}

export async function processStalledSignupDigestJob(
  job: Job
): Promise<StalledSignupDigestResult> {
  logger.info("Stalled signup digest job started", {
    operation: "processStalledSignupDigestJob",
    metadata: {
      bullJobId: job.id?.toString(),
      timestamp: new Date().toISOString(),
    },
  });

  return runStalledSignupDigest(new Date());
}

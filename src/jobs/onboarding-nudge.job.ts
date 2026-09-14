import { Job } from "bull";
import { logger } from "@/utils/logger";
import {
  onboardingNudgeService,
  type NudgeOutcome,
} from "@/services/onboarding-nudge.service";
import {
  isOnboardingNudgeEnabled,
  companyPostalAddress,
} from "@/constants/onboarding-nudge";
import { getCurrentUTCDate } from "@/utils/date.utils";

export interface OnboardingNudgeResult {
  /** Everyone eligible at scan time. */
  candidates: number;
  /** Nudges actually delivered. */
  sent: number;
  /** Eligible but not mailed, by reason. */
  skipped: number;
  failed: number;
  /** Why the whole run did nothing, when it did nothing. */
  reason?: "disabled" | "no-address" | "nobody-eligible";
}

/**
 * Daily scan: mail everyone who signed up, never finished onboarding, and
 * hasn't been nudged yet.
 *
 * Sends are SEQUENTIAL, not parallel. The list is expected to be tiny (one or
 * two a week at current volume), and a serial loop keeps the Resend rate limit
 * irrelevant while making the logs readable in the order things happened. If
 * this ever needs to fan out, batch it — don't just Promise.all a mailing list.
 */
export async function runOnboardingNudge(): Promise<OnboardingNudgeResult> {
  const empty: OnboardingNudgeResult = {
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  // Kill switch before any database work, so merged-but-unflagged is inert.
  if (!isOnboardingNudgeEnabled()) {
    return { ...empty, reason: "disabled" };
  }

  // Compliance gate, checked once up front so a missing postal address is one
  // clear log line rather than N identical per-user skips.
  if (!companyPostalAddress()) {
    logger.warn("Onboarding nudge skipped — COMPANY_POSTAL_ADDRESS is not set", {
      operation: "runOnboardingNudge",
    });
    return { ...empty, reason: "no-address" };
  }

  const now = getCurrentUTCDate();
  const candidates = await onboardingNudgeService.getNudgeCandidates(now);

  if (candidates.length === 0) {
    logger.info("Onboarding nudge: nobody eligible", {
      operation: "runOnboardingNudge",
    });
    return { ...empty, reason: "nobody-eligible" };
  }

  const outcomes: Record<string, number> = {};
  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const outcome: NudgeOutcome = await onboardingNudgeService.sendNudge(candidate);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

    if (outcome === "sent") sent += 1;
    else if (outcome === "send-failed") failed += 1;
  }

  const result: OnboardingNudgeResult = {
    candidates: candidates.length,
    sent,
    skipped: candidates.length - sent - failed,
    failed,
  };

  logger.info("Onboarding nudge run complete", {
    operation: "runOnboardingNudge",
    metadata: { ...result, outcomes },
  });

  return result;
}

/** Bull processor. Never throws: a failed run is tomorrow's run's problem. */
export async function processOnboardingNudge(
  _job: Job
): Promise<OnboardingNudgeResult> {
  try {
    return await runOnboardingNudge();
  } catch (error) {
    logger.error("Onboarding nudge job failed", error as Error, {
      operation: "processOnboardingNudge",
    });
    return { candidates: 0, sent: 0, skipped: 0, failed: 0 };
  }
}

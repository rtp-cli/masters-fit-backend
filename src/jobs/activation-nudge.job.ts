import { Job } from "bull";

import {
  companyPostalAddress,
  isActivationNudgeEnabled,
} from "@/constants/activation-nudge";
import {
  activationNudgeService,
  type ActivationOutcome,
} from "@/services/activation-nudge.service";
import { getCurrentUTCDate } from "@/utils/date.utils";
import { logger } from "@/utils/logger";

export interface ActivationNudgeResult {
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
 * Daily scan: mail everyone who has a plan waiting, has never logged a single
 * exercise, and hasn't been nudged yet.
 *
 * Sends are SEQUENTIAL, not parallel — same reasoning as the onboarding nudge.
 * The list is expected to be tiny, and a serial loop keeps the Resend rate
 * limit irrelevant while making the logs readable in the order things happened.
 * If this ever needs to fan out, batch it — don't just Promise.all a mailing
 * list.
 */
export async function runActivationNudge(): Promise<ActivationNudgeResult> {
  const empty: ActivationNudgeResult = {
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  // Kill switch before any database work, so merged-but-unflagged is inert.
  if (!isActivationNudgeEnabled()) {
    return { ...empty, reason: "disabled" };
  }

  // Compliance gate, checked once up front so a missing postal address is one
  // clear log line rather than N identical per-user skips.
  if (!companyPostalAddress()) {
    logger.warn("Activation nudge skipped — COMPANY_POSTAL_ADDRESS is not set", {
      operation: "runActivationNudge",
    });
    return { ...empty, reason: "no-address" };
  }

  const now = getCurrentUTCDate();
  const candidates = await activationNudgeService.getCandidates(now);

  if (candidates.length === 0) {
    logger.info("Activation nudge: nobody eligible", {
      operation: "runActivationNudge",
    });
    return { ...empty, reason: "nobody-eligible" };
  }

  const outcomes: Record<string, number> = {};
  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const outcome: ActivationOutcome =
      await activationNudgeService.send(candidate);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

    if (outcome === "sent") sent += 1;
    else if (outcome === "send-failed") failed += 1;
  }

  const result: ActivationNudgeResult = {
    candidates: candidates.length,
    sent,
    skipped: candidates.length - sent - failed,
    failed,
  };

  logger.info("Activation nudge run complete", {
    operation: "runActivationNudge",
    metadata: { ...result, outcomes },
  });

  return result;
}

/** Bull processor. Never throws: a failed run is tomorrow's run's problem. */
export async function processActivationNudge(
  _job: Job
): Promise<ActivationNudgeResult> {
  try {
    return await runActivationNudge();
  } catch (error) {
    logger.error("Activation nudge job failed", error as Error, {
      operation: "processActivationNudge",
    });
    return { candidates: 0, sent: 0, skipped: 0, failed: 0 };
  }
}

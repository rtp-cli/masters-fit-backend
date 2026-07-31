import { Job } from "bull";
import { logger } from "@/utils/logger";
import { subscriptionService } from "@/services/subscription.service";
import { emailService } from "@/services/email.service";
import { MANAGE_SUBSCRIPTION_URL } from "@/constants";

export interface RenewalReminderScanResult {
  candidates: number;
  sent: number;
  skipped: number; // lost the claim race (already reminded)
  failed: number; // send threw; claim released for a later retry
}

// "August 12, 2026" in UTC — the stored end date is day-level for our purposes,
// and a fixed zone keeps the rendered date stable regardless of server locale.
function formatRenewalDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatPrice(priceUsd: number | null): string | null {
  return priceUsd != null ? `$${priceUsd.toFixed(2)}` : null;
}

/**
 * Find subscriptions renewing within their per-period reminder window and email
 * each member once. Every send is guarded by an atomic claim, so this is safe to
 * run concurrently and safe to re-run: already-reminded periods are skipped.
 * Exported so it can be invoked directly (tests / manual trigger) without Bull.
 */
export async function runRenewalReminderScan(
  now: Date
): Promise<RenewalReminderScanResult> {
  const candidates = await subscriptionService.getRenewalReminderCandidates(now);

  const result: RenewalReminderScanResult = {
    candidates: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const c of candidates) {
    // Claim FIRST — if a concurrent run already took this period, skip.
    const won = await subscriptionService.claimRenewalReminder(
      c.subscriptionId,
      c.subscriptionEndDate
    );
    if (!won) {
      result.skipped++;
      continue;
    }

    try {
      await emailService.sendRenewalReminderEmail({
        to: c.email,
        name: c.name,
        planLabel: c.billingPeriod ?? "",
        price: formatPrice(c.priceUsd),
        renewalDate: formatRenewalDate(c.subscriptionEndDate),
        manageUrl: MANAGE_SUBSCRIPTION_URL,
      });
      result.sent++;
    } catch (error) {
      // Send failed — release the claim so a later scan retries this period.
      result.failed++;
      await subscriptionService
        .releaseRenewalReminderClaim(c.subscriptionId, c.subscriptionEndDate)
        .catch((releaseErr) =>
          logger.error(
            "Failed to release renewal reminder claim after send failure",
            releaseErr as Error,
            {
              operation: "runRenewalReminderScan",
              metadata: { subscriptionId: c.subscriptionId },
            }
          )
        );
      logger.error("Failed to send renewal reminder email", error as Error, {
        operation: "runRenewalReminderScan",
        metadata: { subscriptionId: c.subscriptionId, userId: c.userId },
      });
    }
  }

  logger.info("Renewal reminder scan complete", {
    operation: "runRenewalReminderScan",
    metadata: result,
  });

  return result;
}

export async function processRenewalReminderJob(
  job: Job
): Promise<RenewalReminderScanResult> {
  logger.info("Renewal reminder job started", {
    operation: "processRenewalReminderJob",
    metadata: { bullJobId: job.id?.toString(), timestamp: new Date().toISOString() },
  });

  return runRenewalReminderScan(new Date());
}

import { Job } from "bull";
import { logger } from "@/utils/logger";
import { emailService } from "@/services/email.service";
import { usageReportService } from "@/services/usage-report.service";
import { isUsageReportEnabled } from "@/constants/usage-report";

export interface UsageReportResult {
  sent: boolean;
  reason?: "disabled" | "send-failed";
  active?: number;
}

/**
 * Build last week's usage report and email it to the owner.
 *
 * No claim column: Bull's fixed repeat jobId already gives one run per fire
 * across instances, and a duplicate would only mean the owner gets the same
 * report twice — nothing customer-facing.
 *
 * Exported so the manual script can call it without Bull.
 */
export async function runUsageReport(now: Date): Promise<UsageReportResult> {
  if (!isUsageReportEnabled()) {
    return { sent: false, reason: "disabled" };
  }

  const report = await usageReportService.buildReport(now);

  try {
    await emailService.sendUsageReportEmail(report);
  } catch (error) {
    logger.error("Failed to send usage report", error as Error, {
      operation: "runUsageReport",
      metadata: { weekStart: report.weekStart.toISOString() },
    });
    return { sent: false, reason: "send-failed", active: report.thisWeek.active };
  }

  return { sent: true, active: report.thisWeek.active };
}

export async function processUsageReportJob(job: Job): Promise<UsageReportResult> {
  logger.info("Usage report job started", {
    operation: "processUsageReportJob",
    metadata: {
      bullJobId: job.id?.toString(),
      timestamp: new Date().toISOString(),
    },
  });

  return runUsageReport(new Date());
}

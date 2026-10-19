/**
 * Manual trigger for the weekly usage report (the Monday cron's email).
 *
 * Every mode only READS the database, inside a read-only transaction, so even
 * against production nothing can be written.
 *
 *   1. PREVIEW (default) — build the report, print the plain-text version, and
 *      write the HTML to ~/Desktop/mastersfit-usage-report.html. Sends nothing.
 *
 *        npm run send-usage-report
 *
 *   2. TEST SEND — email the report to one address you name.
 *
 *        npm run send-usage-report -- --to you@example.com
 *
 *   3. SEND FOR REAL — the same thing the cron does: email the configured
 *      owner inbox (SIGNUP_NOTIFY_EMAIL). Respects the kill switch.
 *
 *        npm run send-usage-report -- --send
 *
 * Add --date YYYY-MM-DD to build the report as if it ran that day (it covers
 * the full Monday–Sunday week BEFORE that date).
 *
 * Against production, wrap it so the URL comes from the Keychain and pass
 * --remote (the script refuses a non-local DATABASE_URL without it):
 *
 *   scripts/with-prod-url.sh npm run send-usage-report -- --remote
 */
// Load .env before importing email.service — it builds the Resend client at
// module load, which needs RESEND_API_KEY present. (ESM runs imports top-down.)
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { emailService } from "@/services/email.service";
import { usageReportService } from "@/services/usage-report.service";
import { usageReportTemplate, usageReportSubject } from "@/templates/usage-report-email";
import { runUsageReport } from "@/jobs/usage-report.job";
import { isUsageReportEnabled } from "@/constants/usage-report";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  if (!isLocal && !flag("remote")) {
    console.error(
      "Refusing to read a non-local DATABASE_URL without --remote.\n" +
        "Re-run with --remote if you meant production (reads only)."
    );
    process.exit(1);
  }

  const dateArg = arg("date");
  // Noon UTC keeps a bare date inside the same Central-time day.
  const now = dateArg ? new Date(`${dateArg}T12:00:00Z`) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error(`--date must be YYYY-MM-DD, got "${dateArg}"`);
    process.exit(1);
  }

  console.log(`Building usage report from ${isLocal ? "LOCAL" : "REMOTE"} db…`);

  if (flag("send")) {
    if (dateArg) {
      console.error("--send always reports last week; use --to with --date for a past week.");
      process.exit(1);
    }
    if (!isUsageReportEnabled()) {
      console.error(
        "The usage report is disabled here (needs SIGNUP_NOTIFY_ENABLED=true and\n" +
          "USAGE_REPORT_ENABLED not 'false'). Use --to for a one-off test send."
      );
      process.exit(1);
    }
    const result = await runUsageReport(now);
    console.log(`✓ ${JSON.stringify(result)}`);
    return;
  }

  const report = await usageReportService.buildReport(now);
  const to = arg("to");

  if (to) {
    await emailService.sendUsageReportEmail(report, [to]);
    console.log(`✓ Sent "${usageReportSubject(report)}" to ${to}`);
    return;
  }

  const { html, text } = usageReportTemplate(report);
  const out = path.join(os.homedir(), "Desktop", "mastersfit-usage-report.html");
  fs.writeFileSync(out, html);
  console.log(`\nSubject: ${usageReportSubject(report)}\n\n${text}\n`);
  console.log(`HTML written to ${out} (nothing sent)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

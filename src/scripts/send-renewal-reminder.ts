/**
 * Manual trigger for the subscription renewal-reminder email.
 *
 * Two modes:
 *
 *   1. TEST SEND — send one rendered reminder to an address you name. Touches
 *      NO database rows (no claim, no real subscribers affected). Use it to see
 *      the email in a real inbox. Defaults the price to the plan's current list
 *      price and the date to the real lead-time window, so it matches a live
 *      send. Override any field with the flags below.
 *
 *        npm run send-renewal-reminder -- --to you@example.com
 *        npm run send-renewal-reminder -- --to you@example.com --plan monthly
 *        npm run send-renewal-reminder -- --to you@example.com --plan annual \
 *          --name "Ada" --price '$89.99' --date "August 12, 2026"
 *
 *   2. RUN THE REAL SCAN NOW — the same thing the 15:00-UTC cron does: find
 *      every ACTIVE subscriber due within their window and email them once
 *      (idempotent via the atomic claim). Emails REAL customers and writes to
 *      the DB. Refuses a non-local DATABASE_URL unless you pass --remote.
 *
 *        npm run send-renewal-reminder -- --run                 # local db
 *        DATABASE_URL="<neon prod url>" npm run send-renewal-reminder -- --run --remote
 */
// Load .env before importing email.service — it builds the Resend client at
// module load, which needs RESEND_API_KEY present. (ESM runs imports top-down.)
import "dotenv/config";
import { emailService } from "@/services/email.service";
import { subscriptionService } from "@/services/subscription.service";
import { runRenewalReminderScan } from "@/jobs/renewal-reminder.job";
import { BillingPeriod, RENEWAL_REMINDER_DAYS, MANAGE_SUBSCRIPTION_URL } from "@/constants";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

async function testSend(to: string) {
  const planLabel = (arg("plan") as "annual" | "monthly") || "annual";
  if (planLabel !== "annual" && planLabel !== "monthly") {
    console.error(`--plan must be "annual" or "monthly" (got "${planLabel}")`);
    process.exit(1);
  }
  const period =
    planLabel === "annual" ? BillingPeriod.ANNUAL : BillingPeriod.MONTHLY;

  // Default price to the plan's current list price so the test matches reality.
  let price = arg("price") ?? null;
  if (price == null) {
    const plans = await subscriptionService.getActiveSubscriptionPlans();
    const plan = plans.find((p) => p.billingPeriod === period);
    price = plan ? `$${Number(plan.priceUsd).toFixed(2)}` : null;
  }
  const renewalDate =
    arg("date") ??
    formatDate(new Date(Date.now() + RENEWAL_REMINDER_DAYS[period] * MS_PER_DAY));
  const name = arg("name") ?? "there";

  console.log(
    `Sending TEST renewal reminder to ${to} — ${planLabel}, ${price ?? "no price"}, renews ${renewalDate}`
  );
  await emailService.sendRenewalReminderEmail({
    to,
    name,
    planLabel,
    price,
    renewalDate,
    manageUrl: MANAGE_SUBSCRIPTION_URL,
  });
  console.log("✓ Sent (no database rows touched).");
}

async function runScan() {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  if (!isLocal && !flag("remote")) {
    console.error(
      "Refusing to run the real scan against a non-local DATABASE_URL without --remote.\n" +
        "This emails REAL subscribers. Re-run with --remote if that's intended."
    );
    process.exit(1);
  }
  console.log(
    `Running the real renewal-reminder scan now against ${isLocal ? "LOCAL" : "REMOTE"} db…`
  );
  const result = await runRenewalReminderScan(new Date());
  console.log("✓ Scan complete:", JSON.stringify(result));
}

async function main() {
  const to = arg("to");
  if (to) {
    await testSend(to);
  } else if (flag("run")) {
    await runScan();
  } else {
    console.log(
      "Usage:\n" +
        "  npm run send-renewal-reminder -- --to you@example.com [--plan annual|monthly] [--name N] [--price '$89.99'] [--date 'August 12, 2026']\n" +
        "  npm run send-renewal-reminder -- --run [--remote]   # run the real scan now"
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { LOGO_URL, FONT, escapeHtml } from "@/templates/email-shared";
import type {
  NewcomerStage,
  UsageReport,
  WeekNumbers,
} from "@/services/usage-report.service";

const STAGE_LABEL: Record<NewcomerStage, string> = {
  trained: "Trained",
  "has-plan": "Has a plan, hasn't trained",
  onboarded: "Finished setup, no plan",
  "signed-up": "Didn't finish setup",
};

const MONEY_LABEL: Record<string, string> = {
  INITIAL_PURCHASE: "Bought",
  RENEWAL: "Renewed",
  CANCELLATION: "Cancelled (keeps access to period end)",
  EXPIRATION: "Expired",
};

/** "Oct 12 – 18" or "Sep 28 – Oct 4", in the report's timezone. */
export function weekLabel(report: UsageReport): string {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: report.timezone, ...opts }).format(d);
  // weekEnd is exclusive (next Monday 00:00); the last day shown is Sunday.
  const lastDay = new Date(report.weekEnd.getTime() - 12 * 60 * 60 * 1000);
  const startMonth = fmt(report.weekStart, { month: "short" });
  const endMonth = fmt(lastDay, { month: "short" });
  const startDay = fmt(report.weekStart, { day: "numeric" });
  const endDay = fmt(lastDay, { day: "numeric" });
  return startMonth === endMonth
    ? `${startMonth} ${startDay} – ${endDay}`
    : `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
}

/** "+2 vs week before", "−1 vs week before", "same as week before". */
export function deltaLabel(current: number, previous: number, money = false): string {
  const diff = Math.round((current - previous) * 100) / 100;
  if (diff === 0) return "same as week before";
  const abs = money ? formatMoney(Math.abs(diff)) : String(Math.abs(diff));
  return `${diff > 0 ? "+" : "−"}${abs} vs week before`;
}

export function usageReportSubject(report: UsageReport): string {
  const { active } = report.thisWeek;
  const diff = active - report.lastWeek.active;
  const trend = diff === 0 ? "" : ` (${diff > 0 ? "+" : "−"}${Math.abs(diff)})`;
  return `[MastersFit] Weekly usage, ${weekLabel(report)}: ${active} trained${trend}`;
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function shortDate(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  }).format(d);
}

/**
 * The weekly usage report. Internal mail to the owner, never to a customer, so
 * it uses the same hand-built internal style as the stalled-signup digest
 * rather than a customer layout (no unsubscribe, no postal address).
 */
export const usageReportTemplate = (report: UsageReport) => {
  const { thisWeek: t, lastWeek: l, timezone } = report;
  const week = weekLabel(report);
  const headline = `${plural(t.active, "person", "people")} trained last week`;

  type Tile = { value: string; label: string; delta: string };
  const tiles = (key: keyof WeekNumbers, label: string, money = false): Tile => ({
    value: money ? formatMoney(t[key]) : String(t[key]),
    label,
    delta: deltaLabel(t[key], l[key], money),
  });
  const rowOne = [
    tiles("active", "Trained"),
    tiles("sessions", "Sessions"),
    tiles("activities", "Activities"),
  ];
  const rowTwo: Tile[] = [
    tiles("signups", "Signups"),
    {
      value: String(report.payingNow),
      label: "Paying now",
      delta: `${report.renewing} set to renew`,
    },
    tiles("revenue", "Revenue", true),
  ];

  const tileHtml = (tile: Tile, last: boolean) => `
                  <td width="33%" align="center" valign="top" style="padding:18px 8px;${last ? "" : " border-right:1px solid #E0E0E0;"}">
                    <div style="font-family:${FONT}; font-size:28px; font-weight:700; line-height:1; color:#0A0A0A;">${escapeHtml(tile.value)}</div>
                    <div style="margin-top:7px; font-family:${FONT}; font-size:11.5px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#757575;">${escapeHtml(tile.label)}</div>
                    <div style="margin-top:5px; font-family:${FONT}; font-size:12px; color:#9E9E9E;">${escapeHtml(tile.delta)}</div>
                  </td>`;

  const tileRow = (row: Tile[], top: boolean) => `
          <tr>
            <td class="px" style="padding:${top ? 26 : 12}px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>${row.map((tile, i) => tileHtml(tile, i === row.length - 1)).join("")}
                </tr>
              </table>
            </td>
          </tr>`;

  type Line = { primary: string; secondary?: string };
  const section = (title: string, why: string, lines: Line[], empty: string) => `
          <tr>
            <td class="px" style="padding:32px 56px 0 56px;">
              <div style="border-top:2px solid #0A0A0A; padding-top:20px;">
                <div style="font-family:${FONT}; font-size:15px; font-weight:700; color:#0A0A0A; letter-spacing:-0.01em;">${escapeHtml(title)} &middot; ${lines.length}</div>
                <div style="margin-top:5px; font-family:${FONT}; font-size:13.5px; line-height:1.55; color:#757575;">${escapeHtml(why)}</div>
                ${
                  lines.length === 0
                    ? `<div style="margin-top:12px; font-family:${FONT}; font-size:14.5px; color:#9E9E9E;">${escapeHtml(empty)}</div>`
                    : lines
                        .map(
                          (line) => `
                <div style="margin-top:12px; font-family:${FONT}; font-size:14.5px; line-height:1.5; color:#0A0A0A;">${escapeHtml(line.primary)}${
                            line.secondary
                              ? `<div style="font-size:13px; color:#757575;">${escapeHtml(line.secondary)}</div>`
                              : ""
                          }</div>`
                        )
                        .join("")
                }
              </div>
            </td>
          </tr>`;

  const trainedLines: Line[] = report.trained.map((u) => ({
    primary: u.name,
    secondary: [
      u.sessions > 0 ? plural(u.sessions, "session") : null,
      u.activities > 0 ? plural(u.activities, "activity", "activities") : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const newcomerLines: Line[] = report.newcomers.map((u) => ({
    primary: `${u.name} — ${STAGE_LABEL[u.stage]}`,
    secondary: [
      `Joined ${shortDate(u.signedUpAt, timezone)}`,
      u.fitnessLevel,
      u.email,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const quietLines: Line[] = report.wentQuiet.map((u) => ({
    primary: u.name,
    secondary: `${plural(u.previousCount, "session or activity", "sessions or activities")} the week before · ${u.email}`,
  }));

  const moneyLines: Line[] = report.moneyEvents.map((m) => ({
    primary: `${m.name} — ${MONEY_LABEL[m.type] ?? m.type}`,
    secondary: `${shortDate(m.at, timezone)}${m.amount > 0 ? ` · ${formatMoney(m.amount)}` : ""}`,
  }));

  const summary = `${report.activatedEver} of ${report.realUsers} real users have ever trained · ${plural(report.comped, "comped account")}`;

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${escapeHtml(headline)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a { text-decoration: none; }
  @media (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#F4F4F4;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F4F4; opacity:0;">
    ${escapeHtml(week)}: ${t.sessions} sessions, ${t.signups} signups, ${escapeHtml(formatMoney(t.revenue))} revenue.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F4F4;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background-color:#FFFFFF; border:1px solid #E0E0E0; border-radius:24px; overflow:hidden;">

          <!-- Logo lockup -->
          <tr>
            <td align="left" class="px" style="padding:44px 56px 0 56px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px; vertical-align:middle;">
                    <img src="${LOGO_URL}" width="34" height="31" alt="MastersFit" style="display:block; width:34px; height:auto;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:${FONT}; font-size:22px; font-weight:500; letter-spacing:-0.01em; color:#0A0A0A;">MastersFit</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td class="px" style="padding:34px 56px 0 56px;">
              <div style="font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#757575;">Weekly usage &middot; ${escapeHtml(week)}</div>
              <h1 style="margin:8px 0 0 0; font-family:${FONT}; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; color:#0A0A0A;">${escapeHtml(headline)}</h1>
              <p style="margin:10px 0 0 0; font-family:${FONT}; font-size:14.5px; line-height:1.6; color:#757575;">${escapeHtml(summary)}</p>
            </td>
          </tr>
${tileRow(rowOne, true)}
${tileRow(rowTwo, false)}
${section("Who trained", "Logged at least one exercise or activity this week.", trainedLines, "Nobody logged anything this week.")}
${section("New this week", "Everyone who signed up, and how far they've got as of this morning.", newcomerLines, "No new signups this week.")}
${section("Went quiet", "Trained the week before, logged nothing this week. Worth a personal note.", quietLines, "Nobody went quiet.")}
${section("Money", "Real App Store and Play purchases, renewals and cancellations this week.", moneyLines, "No purchases, renewals or cancellations this week.")}

          <!-- Definitions -->
          <tr>
            <td class="px" style="padding:30px 56px 40px 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:13px; line-height:1.6; color:#757575;">
                Week is Monday to Sunday, ${escapeHtml(timezone)}. A session is a plan day with at least one exercise logged; activities include health-app imports. Paying and comped counts are as of this morning. Internal and test accounts (@mastersfit.ai, @conradlabs.com) are left out.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td class="px" style="padding:0 56px;">
              <div style="height:1px; background-color:#F0F0F0; line-height:1px; font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="px" align="center" style="padding:24px 56px 36px 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:12.5px; line-height:1.7; color:#9E9E9E;">
                Internal report &middot; sent every Monday
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const textSection = (title: string, lines: Line[], empty: string) =>
    `\n${title.toUpperCase()} (${lines.length})\n${
      lines.length === 0
        ? `  ${empty}\n`
        : lines
            .map((line) => `  ${line.primary}${line.secondary ? `\n    ${line.secondary}` : ""}\n`)
            .join("")
    }`;

  const textTile = (tile: Tile) => `  ${tile.label}: ${tile.value} (${tile.delta})`;

  const text = `Weekly usage · ${week}

${headline}.
${summary}

${[...rowOne, ...rowTwo].map(textTile).join("\n")}
${textSection("Who trained", trainedLines, "Nobody logged anything this week.")}${textSection(
    "New this week",
    newcomerLines,
    "No new signups this week."
  )}${textSection("Went quiet", quietLines, "Nobody went quiet.")}${textSection(
    "Money",
    moneyLines,
    "No purchases, renewals or cancellations this week."
  )}
Week is Monday to Sunday, ${timezone}. A session is a plan day with at least one
exercise logged; activities include health-app imports. Paying and comped counts
are as of this morning. Internal and test accounts are left out.

Internal report · sent every Monday`;

  return { html, text };
};

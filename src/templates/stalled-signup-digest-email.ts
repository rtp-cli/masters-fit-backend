import { LOGO_URL, FONT, escapeHtml } from "@/templates/email-shared";

export interface StalledPersonRow {
  /**
   * Absent for the "never finished sign-in" group: those people have no user
   * row, and a name is only collected on the screen AFTER a code is verified.
   * The address is genuinely all we know about them.
   */
  name?: string;
  email: string;
  /** "Stalled 5 days" */
  stalledLabel: string;
  /** "Signed up Sep 2 · never signed in" */
  metaLine: string;
  /** True for someone appearing in a digest for the first time. */
  isNew: boolean;
}

export interface StalledSignupDigestTemplateProps {
  /** People who never completed a sign-in — stuck at the code screen. */
  neverSignedIn: StalledPersonRow[];
  /** People who signed in but never saved a profile. */
  signedInNoProfile: StalledPersonRow[];
  newCount: number;
  totalCount: number;
  signupsLast7Days: number;
  finishedLast7Days: number;
}

/**
 * The daily stalled-signup worklist. Only ever rendered when at least one
 * person is new to the list — the job refuses to send otherwise, so this
 * template never has to represent an "all clear" state.
 *
 * The two groups are the point of the email: someone who never got past the
 * code screen needs their address checked, someone who signed in and quit the
 * questionnaire needs a nudge. Flattening them into one list would lose that.
 */
export const stalledSignupDigestTemplate = ({
  neverSignedIn,
  signedInNoProfile,
  newCount,
  totalCount,
  signupsLast7Days,
  finishedLast7Days,
}: StalledSignupDigestTemplateProps) => {
  const headline =
    newCount === totalCount
      ? `${plural(newCount, "person", "people")} signed up but haven't finished`
      : `${plural(newCount, "new person", "new people")} stalled, ${totalCount} open in total`;

  // With no name, the address IS the identity — it becomes the headline rather
  // than sitting under a blank space where a name would be.
  const personHtml = (p: StalledPersonRow) => {
    const badges = `<span style="font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#757575; background-color:#F0F0F0; border-radius:999px; padding:3px 9px; margin-left:8px; white-space:nowrap;">${escapeHtml(p.stalledLabel)}</span>${
      p.isNew
        ? `<span style="font-family:${FONT}; font-size:12px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#FFFFFF; background-color:#0A0A0A; border-radius:999px; padding:3px 9px; margin-left:6px;">New</span>`
        : ""
    }`;

    const identity = p.name
      ? `<span style="font-family:${FONT}; font-size:16px; font-weight:700; color:#0A0A0A;">${escapeHtml(p.name)}</span>${badges}
                    <div style="margin-top:6px;">
                      <a href="mailto:${escapeHtml(p.email)}" style="font-family:${FONT}; font-size:14.5px; color:#0A0A0A; text-decoration:underline;">${escapeHtml(p.email)}</a>
                    </div>`
      : `<a href="mailto:${escapeHtml(p.email)}" style="font-family:${FONT}; font-size:16px; font-weight:700; color:#0A0A0A; text-decoration:underline;">${escapeHtml(p.email)}</a>${badges}`;

    return `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E0E0E0; border-radius:14px; margin-top:14px;">
                <tr>
                  <td style="padding:16px 18px;">
                    ${identity}
                    <div style="margin-top:9px; font-family:${FONT}; font-size:13.5px; line-height:1.6; color:#757575;">${escapeHtml(p.metaLine)}</div>
                  </td>
                </tr>
              </table>`;
  };

  const groupHtml = (title: string, why: string, people: StalledPersonRow[]) =>
    people.length === 0
      ? ""
      : `
          <tr>
            <td class="px" style="padding:32px 56px 0 56px;">
              <div style="border-top:2px solid #0A0A0A; padding-top:20px;">
                <div style="font-family:${FONT}; font-size:15px; font-weight:700; color:#0A0A0A; letter-spacing:-0.01em;">${escapeHtml(title)} &middot; ${people.length}</div>
                <div style="margin-top:5px; font-family:${FONT}; font-size:13.5px; line-height:1.55; color:#757575;">${escapeHtml(why)}</div>
                ${people.map(personHtml).join("")}
              </div>
            </td>
          </tr>`;

  const counter = (value: number, label: string, flag = false) => `
                  <td width="33%" align="center" style="padding:18px 10px; border-right:1px solid #E0E0E0;">
                    <div style="font-family:${FONT}; font-size:28px; font-weight:700; line-height:1; color:${flag ? "#B06105" : "#0A0A0A"};">${value}</div>
                    <div style="margin-top:7px; font-family:${FONT}; font-size:11.5px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#757575;">${escapeHtml(label)}</div>
                  </td>`;

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
    .px { padding-left: 28px !important; padding-right: 28px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#F4F4F4;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F4F4; opacity:0;">
    ${newCount} new since the last digest &mdash; ${totalCount} still open.
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
              <h1 style="margin:0; font-family:${FONT}; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; color:#0A0A0A;">${escapeHtml(headline)}</h1>
            </td>
          </tr>

          <!-- Counters -->
          <tr>
            <td class="px" style="padding:26px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>
${counter(signupsLast7Days, "Signed up (7d)")}
${counter(finishedLast7Days, "Finished (7d)")}
                  <td width="33%" align="center" style="padding:18px 10px;">
                    <div style="font-family:${FONT}; font-size:28px; font-weight:700; line-height:1; color:#B06105;">${totalCount}</div>
                    <div style="margin-top:7px; font-family:${FONT}; font-size:11.5px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#757575;">Stalled now</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${groupHtml(
  "Never finished sign-in",
  "No sign-in was ever completed — they stopped at the code screen. Most have no account at all, so there is no name to show: the app asks for one only after a code is verified. Check the spelling against your invite list, then re-send.",
  neverSignedIn
)}
${groupHtml(
  "Got in, didn't finish setup",
  "Signed in and saw the app, but never saved a profile. They quit somewhere in the setup questions.",
  signedInNoProfile
)}

          <!-- Sign-off -->
          <tr>
            <td class="px" style="padding:30px 56px 40px 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:14px; line-height:1.6; color:#757575;">
                This list only arrives on days someone new joins it. Names stay until they finish onboarding, then drop off after 30 days.
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
                Internal notification &middot; not sent to the user
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const textGroup = (title: string, why: string, people: StalledPersonRow[]) =>
    people.length === 0
      ? ""
      : `\n${title.toUpperCase()} (${people.length})\n${why}\n\n${people
          .map(
            (p) =>
              p.name
                ? `  ${p.name} — ${p.stalledLabel}${p.isNew ? " [NEW]" : ""}\n  ${p.email}\n  ${p.metaLine}\n`
                : `  ${p.email} — ${p.stalledLabel}${p.isNew ? " [NEW]" : ""}\n  ${p.metaLine}\n`
          )
          .join("\n")}`;

  const text = `${headline}.

Signed up (7d): ${signupsLast7Days} · Finished (7d): ${finishedLast7Days} · Stalled now: ${totalCount}
${textGroup(
  "Never finished sign-in",
  "No sign-in was ever completed. Most have no account at all, so there is no name to show.",
  neverSignedIn
)}${textGroup(
    "Got in, didn't finish setup",
    "Signed in and saw the app, but never saved a profile.",
    signedInNoProfile
  )}
This list only arrives on days someone new joins it. Names stay until they
finish onboarding, then drop off after 30 days.

Internal notification · not sent to the user`;

  return { html, text };
};

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const LOGO_URL = process.env.LOGO_URL || "https://mastersfit.ai/email/logo-dark.png";

interface RenewalReminderTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /** "annual" | "monthly" — how the plan renews, for the copy. */
  planLabel: string;
  /** Formatted price, e.g. "$49.99". Null when the plan couldn't be resolved. */
  price: string | null;
  /** Formatted renewal date, e.g. "August 12, 2026". */
  renewalDate: string;
  /** Where the "Manage your subscription" button points. */
  manageUrl: string;
}

const FONT =
  "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const renewalReminderTemplate = ({
  name,
  planLabel,
  price,
  renewalDate,
  manageUrl,
}: RenewalReminderTemplateProps) => {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const year = new Date().getFullYear();

  // planLabel is "" only on a (rare) plan-lookup miss; keep phrasing clean.
  const membership = planLabel ? `${planLabel} membership` : "membership";
  const planLine = planLabel ? `${planLabel} plan` : "MastersFit+";

  // Annual reads "for another year"; monthly just "automatically".
  const continues =
    planLabel === "annual"
      ? "will automatically continue for another year"
      : "will continue automatically";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>Your MastersFit+ renews on ${renewalDate}</title>
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
    A quick heads-up before your ${membership} renews on ${renewalDate} &mdash; no action needed to continue.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F4F4;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background-color:#FFFFFF; border:1px solid #E0E0E0; border-radius:24px; overflow:hidden;">

          <!-- Logo lockup -->
          <tr>
            <td align="center" class="px" style="padding:44px 56px 0 56px;">
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
            <td class="px" style="padding:36px 56px 0 56px;">
              <h1 style="margin:0; font-family:${FONT}; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; color:#0A0A0A;">Your membership renews soon</h1>
            </td>
          </tr>

          <!-- Body copy -->
          <tr>
            <td class="px" style="padding:18px 56px 0 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#3C3C3C;">
                ${greeting}
              </p>
              <p style="margin:14px 0 0 0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#3C3C3C;">
                Just a heads-up: your <strong style="color:#0A0A0A;">MastersFit+ ${membership}</strong> renews on <strong style="color:#0A0A0A;">${renewalDate}</strong>, and your subscription ${continues}.
              </p>
            </td>
          </tr>

          <!-- Renewal details block -->
          <tr>
            <td class="px" style="padding:28px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#757575;">Renews on</div>
                    <div style="margin-top:6px; font-family:${FONT}; font-size:20px; font-weight:700; color:#0A0A0A; line-height:1.2;">${renewalDate}</div>
                    ${
                      price
                        ? `<div style="margin-top:4px; font-family:${FONT}; font-size:15px; color:#3C3C3C;">${price} &middot; ${planLine}</div>`
                        : `<div style="margin-top:4px; font-family:${FONT}; font-size:15px; color:#3C3C3C;">${planLine}</div>`
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Reassurance -->
          <tr>
            <td class="px" style="padding:22px 56px 0 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#3C3C3C;">
                <strong style="color:#0A0A0A;">Nothing to do if you&rsquo;re staying</strong> &mdash; your workouts, history, and streak keep going without interruption. If you&rsquo;d like to make a change first, you can manage or cancel anytime.
              </p>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td class="px" style="padding:28px 56px 0 56px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:14px; background-color:#0A0A0A;">
                    <a href="${manageUrl}" style="display:inline-block; padding:16px 32px; font-family:${FONT}; font-size:16px; font-weight:600; color:#FFFFFF; border-radius:14px;">Manage your subscription</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td class="px" style="padding:30px 56px 44px 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#3C3C3C;">
                Train well,<br />The MastersFit team
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td class="px" style="padding:0 56px;">
              <div style="height:1px; background-color:#F4F4F4; line-height:1px; font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="px" align="center" style="padding:28px 56px 40px 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:13px; line-height:1.6; color:#9E9E9E;">
                You&rsquo;re receiving this because you have an active MastersFit+ subscription.
              </p>
              <p style="margin:14px 0 0 0; font-family:${FONT}; font-size:12px; line-height:1.7; color:#9E9E9E;">
                <a href="https://mastersfit.ai/privacy" style="color:#757575; text-decoration:underline;">Privacy</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://mastersfit.ai/terms" style="color:#757575; text-decoration:underline;">Terms</a><br />
                &copy; ${year} MastersFit. All rights reserved.
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-card brand line -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px;">
          <tr>
            <td align="center" style="padding:20px 16px 0 16px;">
              <p style="margin:0; font-family:${FONT}; font-size:12px; letter-spacing:0.04em; color:#C0C0C0;">
                Fitness Mastered. AI-Powered.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const text = `${greeting}

Just a heads-up: your MastersFit+ ${membership} renews on ${renewalDate}, and your subscription ${continues}.

Renews on: ${renewalDate}${price ? ` (${price}, ${planLine})` : ` (${planLine})`}

Nothing to do if you're staying — your workouts, history, and streak keep going without interruption. If you'd like to make a change first, you can manage or cancel anytime here:
${manageUrl}

Train well,
The MastersFit team

You're receiving this because you have an active MastersFit+ subscription.
Privacy: https://mastersfit.ai/privacy | Terms: https://mastersfit.ai/terms
© ${year} MastersFit. All rights reserved.`;

  return { html, text };
};

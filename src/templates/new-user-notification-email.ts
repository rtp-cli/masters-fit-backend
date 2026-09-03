import { LOGO_URL, FONT, MONO, escapeHtml } from "@/templates/email-shared";

export interface NewUserNotificationTemplateProps {
  userId: number;
  name: string;
  email: string;
  /** "6 minutes ago" — how long between creating the account and finishing. */
  signedUpAgo: string;
  /** "12:41 PM CDT" — when onboarding completed. */
  completedAt: string;
  /** Subscription row status, e.g. "trial". Null when no row exists yet. */
  subscriptionStatus: string | null;
  /** Pre-formatted "label: value" lines describing what they set up. */
  profileRows: { label: string; value: string }[];
  /** The ready-to-paste comp command. */
  compCommand: string;
}

/**
 * Internal alert sent to the owner when someone finishes onboarding. Not user
 * mail — it exists so a friends-and-family invite can be comped promptly, so it
 * leads with who joined and ends with the exact command to comp them.
 *
 * Follows the same 600px card as the customer templates, deliberately: it is
 * the house style and it renders predictably in every client.
 */
export const newUserNotificationTemplate = ({
  userId,
  name,
  email,
  signedUpAgo,
  completedAt,
  subscriptionStatus,
  profileRows,
  compCommand,
}: NewUserNotificationTemplateProps) => {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const statusLabel = subscriptionStatus
    ? escapeHtml(subscriptionStatus.charAt(0).toUpperCase() + subscriptionStatus.slice(1))
    : "No subscription row yet";

  const detailRow = (label: string, value: string, bold = true) => `
              <tr>
                <td style="padding:5px 16px 5px 0; font-family:${FONT}; font-size:14px; color:#757575; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td>
                <td style="padding:5px 0; font-family:${FONT}; font-size:15px; color:${bold ? "#0A0A0A" : "#3C3C3C"}; font-weight:${bold ? 600 : 400}; line-height:1.45;">${value}</td>
              </tr>`;

  const profileRowsHtml = profileRows
    .map((r) => detailRow(r.label, escapeHtml(r.value), false))
    .join("");

  const profileBlock =
    profileRows.length > 0
      ? `
          <tr>
            <td class="px" style="padding:26px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#757575; padding-bottom:12px;">What they set up</div>
                    <table role="presentation" cellpadding="0" cellspacing="0">${profileRowsHtml}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${safeName} just finished onboarding</title>
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
    ${safeEmail} &mdash; signed up ${escapeHtml(signedUpAgo)}, onboarding complete.
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
              <h1 style="margin:0; font-family:${FONT}; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; color:#0A0A0A;">${safeName} just finished onboarding</h1>
              <p style="margin:8px 0 0 0; font-family:${FONT}; font-size:14px; line-height:1.6; color:#757575;">User #${userId} &middot; signed up ${escapeHtml(signedUpAgo)} &middot; completed onboarding ${escapeHtml(completedAt)}</p>
            </td>
          </tr>

          <!-- Who joined -->
          <tr>
            <td class="px" style="padding:26px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#757575; padding-bottom:12px;">Who joined</div>
                    <table role="presentation" cellpadding="0" cellspacing="0">
${detailRow("Name", safeName)}
${detailRow("Email", `<a href="mailto:${safeEmail}" style="color:#0A0A0A; text-decoration:underline;">${safeEmail}</a>`)}
${detailRow("Subscription", statusLabel)}
${detailRow("User ID", String(userId))}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${profileBlock}

          <!-- Comp command -->
          <tr>
            <td class="px" style="padding:26px 56px 0 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#3C3C3C;"><strong style="color:#0A0A0A;">To comp this subscription:</strong></p>
              <div style="margin-top:12px; background-color:#0A0A0A; border-radius:12px; padding:14px 18px;">
                <span style="font-family:${MONO}; font-size:13px; line-height:1.5; color:#FFFFFF;">${escapeHtml(compCommand)}</span>
              </div>
            </td>
          </tr>

          <!-- Reply hint -->
          <tr>
            <td class="px" style="padding:20px 56px 0 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:14px; line-height:1.6; color:#757575;">
                Hit reply to write to ${safeName} directly &mdash; this email is addressed from them.
              </p>
              <p style="margin:28px 0 40px 0; font-family:${FONT}; font-size:14px; line-height:1.6; color:#757575;">
                Sent automatically by the MastersFit backend.
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

  const profileText =
    profileRows.length > 0
      ? `\nWHAT THEY SET UP\n${profileRows
          .map((r) => `  ${`${r.label}:`.padEnd(14)}${r.value}`)
          .join("\n")}\n`
      : "";

  const text = `${name} just finished onboarding.

User #${userId} · signed up ${signedUpAgo} · completed onboarding ${completedAt}

WHO JOINED
  ${"Name:".padEnd(14)}${name}
  ${"Email:".padEnd(14)}${email}
  ${"Subscription:".padEnd(14)}${subscriptionStatus ?? "No subscription row yet"}
  ${"User ID:".padEnd(14)}${userId}
${profileText}
To comp this subscription:
  ${compCommand}

Hit reply to write to ${name} directly — this email is addressed from them.

Sent automatically by the MastersFit backend.
Internal notification · not sent to the user`;

  return { html, text };
};

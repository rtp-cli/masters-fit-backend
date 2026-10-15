import { LOGO_URL, FONT, escapeHtml } from "@/templates/email-shared";

export type SubscriptionAlertKind = "purchase" | "cancellation";

export interface SubscriptionAlertTemplateProps {
  kind: SubscriptionAlertKind;
  userId: number;
  name: string;
  email: string;
  /** The headline, e.g. "Jane Doe started a free trial". */
  headline: string;
  /** One-line summary under the headline — also the inbox preview text. */
  summary: string;
  /**
   * Shown as a highlighted banner when set. Used to make a free trial
   * impossible to mistake for money in the bank.
   */
  callout: string | null;
  /** Pre-formatted "label: value" rows describing the event. */
  detailRows: { label: string; value: string }[];
}

/**
 * Internal alert sent to the owner when a customer starts paying (or starts a
 * trial) or cancels. Not user mail.
 *
 * Same 600px card as the new-user alert, deliberately: it is the house style,
 * and an owner inbox where every internal alert looks alike is easier to scan.
 */
export const subscriptionAlertTemplate = ({
  kind,
  userId,
  name,
  email,
  headline,
  summary,
  callout,
  detailRows,
}: SubscriptionAlertTemplateProps) => {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeHeadline = escapeHtml(headline);

  const detailRow = (label: string, value: string, bold = true) => `
              <tr>
                <td style="padding:5px 16px 5px 0; font-family:${FONT}; font-size:14px; color:#757575; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td>
                <td style="padding:5px 0; font-family:${FONT}; font-size:15px; color:${bold ? "#0A0A0A" : "#3C3C3C"}; font-weight:${bold ? 600 : 400}; line-height:1.45;">${value}</td>
              </tr>`;

  const detailRowsHtml = detailRows
    .map((r) => detailRow(r.label, escapeHtml(r.value), false))
    .join("");

  const calloutBlock = callout
    ? `
          <tr>
            <td class="px" style="padding:26px 56px 0 56px;">
              <div style="background-color:#FFF8E1; border:1px solid #F2D27A; border-radius:12px; padding:14px 18px; font-family:${FONT}; font-size:15px; line-height:1.5; color:#5C4300; font-weight:600;">${escapeHtml(callout)}</div>
            </td>
          </tr>`
    : "";

  const sectionTitle = kind === "purchase" ? "The purchase" : "The cancellation";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${safeHeadline}</title>
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
    ${escapeHtml(summary)}
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
              <h1 style="margin:0; font-family:${FONT}; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; color:#0A0A0A;">${safeHeadline}</h1>
              <p style="margin:8px 0 0 0; font-family:${FONT}; font-size:14px; line-height:1.6; color:#757575;">${escapeHtml(summary)}</p>
            </td>
          </tr>
${calloutBlock}

          <!-- Who -->
          <tr>
            <td class="px" style="padding:26px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#757575; padding-bottom:12px;">Who</div>
                    <table role="presentation" cellpadding="0" cellspacing="0">
${detailRow("Name", safeName)}
${detailRow("Email", `<a href="mailto:${safeEmail}" style="color:#0A0A0A; text-decoration:underline;">${safeEmail}</a>`)}
${detailRow("User ID", String(userId))}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What happened -->
          <tr>
            <td class="px" style="padding:26px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#757575; padding-bottom:12px;">${sectionTitle}</div>
                    <table role="presentation" cellpadding="0" cellspacing="0">${detailRowsHtml}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Reply hint -->
          <tr>
            <td class="px" style="padding:20px 56px 0 56px;">
              <p style="margin:0; font-family:${FONT}; font-size:14px; line-height:1.6; color:#757575;">
                Only you received this. Replying will email ${safeName} (${safeEmail}) directly.
              </p>
              <p style="margin:28px 0 40px 0; font-family:${FONT}; font-size:14px; line-height:1.6; color:#757575;">
                Sent automatically by the MastersFit backend from a RevenueCat webhook.
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

  const text = `${headline}.

${summary}
${callout ? `\n>>> ${callout}\n` : ""}
WHO
  ${"Name:".padEnd(14)}${name}
  ${"Email:".padEnd(14)}${email}
  ${"User ID:".padEnd(14)}${userId}

${sectionTitle.toUpperCase()}
${detailRows.map((r) => `  ${`${r.label}:`.padEnd(14)}${r.value}`).join("\n")}

Only you received this. Replying will email ${name} (${email}) directly.

Sent automatically by the MastersFit backend from a RevenueCat webhook.
Internal notification · not sent to the user`;

  return { html, text };
};

import { escapeHtml } from "@/templates/email-shared";

interface ActivationNudgeTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /** Their active plan's name, e.g. "Advanced Full-Body Strength". */
  planName: string;
  /**
   * The session the email points at, e.g. "Full-Body Strength". Null when the
   * plan has no incomplete day left, in which case the copy falls back to
   * naming the plan instead of printing an empty string.
   */
  firstSessionName: string | null;
  /** Where "Start your first workout" points — a web page, never a scheme. */
  startUrl: string;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/**
 * The activation nudge — for someone whose plan is built and untouched.
 *
 * Same deliberately undesigned note style as the onboarding nudge, for the same
 * reason: at this scale a plain message from a person outperforms a designed
 * one, and the moment it grows a hero image it becomes something people archive
 * unread.
 *
 * The one thing this email must do that a generic "come back" cannot: name the
 * actual session waiting for them. The plan is already built — the whole point
 * is that there is a specific, concrete thing to go and do, not a chore to
 * resume. "Your Full-Body Strength session is ready" is a different proposition
 * from "you haven't worked out yet".
 */
export const activationNudgeTemplate = ({
  name,
  planName,
  firstSessionName,
  startUrl,
  unsubscribeUrl,
  postalAddress,
}: ActivationNudgeTemplateProps) => {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const textGreeting = firstName ? `Hi ${firstName},` : "Hi there,";

  // Fall back to the plan name when no incomplete day resolved, so the sentence
  // still names something real rather than trailing off.
  const sessionPlain = firstSessionName?.trim() || planName?.trim() || "";
  const sessionHtml = escapeHtml(sessionPlain);

  const openingHtml = sessionPlain
    ? `Your <strong>${sessionHtml}</strong> session is built and waiting in the app &mdash; you haven't started it yet.`
    : `Your plan is built and waiting in the app &mdash; you haven't started it yet.`;
  const openingText = sessionPlain
    ? `Your ${sessionPlain} session is built and waiting in the app - you haven't started it yet.`
    : `Your plan is built and waiting in the app - you haven't started it yet.`;

  const href = escapeHtml(startUrl);
  const unsubHref = escapeHtml(unsubscribeUrl);
  // Escape FIRST, then turn newlines into breaks — the other order would escape
  // the <br> tags.
  const address = escapeHtml(postalAddress).replace(/\r?\n/g, "<br />");

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />
<title>Your first session is ready</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  a { color:#1A6B4A; }
  a[x-apple-data-detectors] {
    color: inherit !important;
    text-decoration: none !important;
    font-size: inherit !important;
    font-family: inherit !important;
    font-weight: inherit !important;
    line-height: inherit !important;
  }
  @media (max-width: 620px) {
    .wrap { padding:24px 20px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#FFFFFF;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#FFFFFF; opacity:0;">
    Your plan is built &mdash; the first session takes one tap to start.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          ${greeting}
        </p>

        <p style="margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          ${openingHtml}
        </p>

        <p style="margin:0 0 24px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          Nothing to set up and nothing to decide &mdash; open the app, tap Start, and it walks you through it one exercise at a time. You can stop partway and it keeps what you did.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
          <tr>
            <td style="background-color:#1A6B4A; border-radius:8px;">
              <a href="${href}" style="display:inline-block; padding:12px 24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:600; color:#FFFFFF; text-decoration:none;">Start your first workout</a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 24px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          And if the plan isn't right &mdash; too long, too hard, wrong equipment &mdash; hit reply and tell me. I'd rather fix it than have you not use it.
        </p>

        <p style="margin:0 0 32px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          &mdash; Rich
        </p>

        <hr style="border:0; border-top:1px solid #E5E5E5; margin:0 0 16px 0;" />

        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.5; color:#767676;">
          <a href="${unsubHref}" style="color:#767676; text-decoration:underline;">Unsubscribe from these emails</a><br />
          ${address}
        </p>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const text = `${textGreeting}

${openingText}

Nothing to set up and nothing to decide - open the app, tap Start, and it walks you through it one exercise at a time. You can stop partway and it keeps what you did.

Start your first workout: ${startUrl}

And if the plan isn't right - too long, too hard, wrong equipment - hit reply and tell me. I'd rather fix it than have you not use it.

- Rich

---
Unsubscribe from these emails: ${unsubscribeUrl}
${postalAddress}
`;

  return { html, text };
};

/**
 * Subject line.
 *
 * Names the thing that already exists rather than the absence of action. "You
 * haven't worked out yet" is an accusation and reads as a chore; this says
 * there is something built and ready, which is the honest and more inviting
 * framing of the same fact.
 */
export const ACTIVATION_NUDGE_SUBJECT = "Your first session is ready";

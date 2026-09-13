import { escapeHtml } from "@/templates/email-shared";

interface OnboardingNudgeTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /** Where "Finish setting up" points — a web page, never a custom scheme. */
  continueUrl: string;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/**
 * The onboarding nudge.
 *
 * Deliberately NOT built on the branded table layout the other templates use.
 * This is meant to read as a note from a person: no logo lockup, no card, no
 * 600px marketing frame, system fonts. The whole reason it outperforms a
 * designed email at this scale is that it doesn't look designed — the moment it
 * grows a hero image it becomes something people archive unread.
 *
 * The reply invitation is the real payload. One "here's why I bailed" answer is
 * worth more right now than the conversion is.
 */
export const onboardingNudgeTemplate = ({
  name,
  continueUrl,
  unsubscribeUrl,
  postalAddress,
}: OnboardingNudgeTemplateProps) => {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const textGreeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const href = escapeHtml(continueUrl);
  const unsubHref = escapeHtml(unsubscribeUrl);
  // Escape FIRST, then turn newlines into breaks — the other order would
  // escape the <br> tags. Lets the env var hold either a one-line address or a
  // pasted multi-line one without the HTML collapsing it into a run-on.
  const address = escapeHtml(postalAddress).replace(/\r?\n/g, "<br />");

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>Your MastersFit plan is still waiting</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  a { color:#1A6B4A; }
  @media (max-width: 620px) {
    .wrap { padding:24px 20px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#FFFFFF;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#FFFFFF; opacity:0;">
    You started setting up MastersFit but didn't finish &mdash; it takes about two minutes.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          ${greeting}
        </p>

        <p style="margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          You started setting up MastersFit a couple of days ago but didn't make it to the end, so you never got your first plan.
        </p>

        <p style="margin:0 0 24px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          It takes about two minutes to finish &mdash; a few questions about your goals, your schedule, and what equipment you've got. Then it builds your week.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
          <tr>
            <td style="background-color:#1A6B4A; border-radius:8px;">
              <a href="${href}" style="display:inline-block; padding:12px 24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:600; color:#FFFFFF; text-decoration:none;">Finish setting up</a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 24px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          If something got in the way &mdash; confusing, broken, not what you expected &mdash; just hit reply and tell me. I read every one.
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

You started setting up MastersFit a couple of days ago but didn't make it to the end, so you never got your first plan.

It takes about two minutes to finish - a few questions about your goals, your schedule, and what equipment you've got. Then it builds your week.

Finish setting up: ${continueUrl}

If something got in the way - confusing, broken, not what you expected - just hit reply and tell me. I read every one.

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
 * The draft this shipped from read "Want me to finish setting this up?", which
 * invites a reply but promises something the sender can't actually do — nobody
 * can finish your profile for you. This one says what's on the other side of
 * the click instead.
 */
export const ONBOARDING_NUDGE_SUBJECT = "You're two minutes from your first plan";

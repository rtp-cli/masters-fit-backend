import { escapeHtml } from "@/templates/email-shared";

interface CompGrantedTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
}

/**
 * "I've comped your account" — sent when a user is granted COMPLIMENTARY access.
 *
 * TRANSACTIONAL, and that is the difference from the onboarding nudge next door.
 * This tells someone their account changed, which puts it in the same category as
 * a receipt: no unsubscribe link, no postal address, and the caller deliberately
 * does NOT check `email_opted_out_at` — opting out of setup reminders should not
 * stop us telling you your access changed.
 *
 * Same plain, personal styling as the nudge: no logo lockup, no card, system
 * fonts. It is a note from Rich, not a product announcement.
 *
 * Deliberately does NOT promise permanence. A comp has no expiry but is a single
 * revocable column, and "free forever" is a promise that outlives the decision.
 */
export const compGrantedTemplate = ({ name }: CompGrantedTemplateProps) => {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const textGreeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const P =
    "margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />
<title>You're on MastersFit+</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  a { color:#1A6B4A; }
  a[x-apple-data-detectors] {
    color: inherit !important; text-decoration: none !important; font-size: inherit !important;
    font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important;
  }
  @media (max-width: 620px) { .wrap { padding:24px 20px !important; } }
</style>
</head>
<body style="margin:0; padding:0; background-color:#FFFFFF;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#FFFFFF; opacity:0;">
    I've upgraded your account to MastersFit+ &mdash; no charge, nothing to do.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="${P}">${greeting}</p>

        <p style="${P}">
          Thanks for giving MastersFit a try. I've upgraded your account to <strong>MastersFit+</strong> &mdash; no charge, and nothing you need to do.
        </p>

        <p style="${P}">
          That means no paywall and no limits on building or adjusting workouts: the same access a paying member gets.
        </p>

        <p style="${P}">
          One thing worth knowing &mdash; if the app is open right now, close it all the way and reopen it. It checks your access level when it starts up, so the upgrade won't show until it does.
        </p>

        <p style="${P}">
          If anything looks wrong, or you've got thoughts on the app, just hit reply. I read every one.
        </p>

        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          &mdash; Rich
        </p>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const text = `${textGreeting}

Thanks for giving MastersFit a try. I've upgraded your account to MastersFit+ - no charge, and nothing you need to do.

That means no paywall and no limits on building or adjusting workouts: the same access a paying member gets.

One thing worth knowing - if the app is open right now, close it all the way and reopen it. It checks your access level when it starts up, so the upgrade won't show until it does.

If anything looks wrong, or you've got thoughts on the app, just hit reply. I read every one.

- Rich
`;

  return { html, text };
};

export const COMP_GRANTED_SUBJECT = "You're on MastersFit+, on me";

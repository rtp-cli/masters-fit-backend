import { escapeHtml } from "@/templates/email-shared";

/** Which store's subscription settings the "manage or cancel" line points at. */
export type SubscriberWelcomeStore = "app_store" | "play_store" | "unknown";

export interface SubscriberWelcomeTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /**
   * True when the subscription started as a free trial. Changes ONE sentence:
   * a trial customer has not been charged, so nothing may say they were.
   */
  isTrial: boolean;
  store: SubscriberWelcomeStore;
}

export const SUBSCRIBER_WELCOME_SUBJECT = "Welcome to MastersFit+";

/**
 * What a subscriber gets. Copied word for word from the app's paywall
 * (frontend `constants/subscription.ts` MASTERSFIT_PLUS_BENEFITS), which is the
 * owner-approved list and maps one-to-one to real free-vs-Plus differences in
 * `constants/access-policy.ts`. Keep the two in step: this email must never
 * promise something the paywall doesn't (e.g. "explains why it swapped", which
 * is not built).
 */
export const MASTERSFIT_PLUS_BENEFITS = [
  "Flexible plan adjustments — reshape any week or day as your training needs change",
  "New training plans whenever your goals, schedule, or equipment change",
  "Progress analytics — strength trends, training volume, and personal records",
  "Auto-sync your workouts to Apple Health and Health Connect",
] as const;

/** The "how to change or cancel" sentence, worded for the store they bought through. */
export function manageSubscriptionLine(store: SubscriberWelcomeStore): string {
  switch (store) {
    case "app_store":
      return "If you ever want to change or cancel your subscription, that's handled by Apple: on your iPhone, open Settings, tap your name, then Subscriptions.";
    case "play_store":
      return "If you ever want to change or cancel your subscription, that's handled by Google Play: open the Play Store app, tap your profile picture, then Payments & subscriptions, then Subscriptions.";
    default:
      return "If you ever want to change or cancel your subscription, that's handled by the store you subscribed through, in the App Store or Google Play subscription settings.";
  }
}

/** The opening line. The only sentence that differs for a free trial. */
export function openingLine(isTrial: boolean): string {
  return isTrial
    ? "Thanks for starting your MastersFit+ free trial. Nothing has been charged yet."
    : "Thanks for subscribing to MastersFit+.";
}

/**
 * "Welcome to MastersFit+" — sent to the CUSTOMER right after a paid
 * subscription starts (a production INITIAL_PURCHASE).
 *
 * TRANSACTIONAL, like the comp note: it confirms a change the customer just
 * made to their own account, so it carries no unsubscribe link or postal
 * address, and the caller does not consult `email_opted_out_at`.
 *
 * Same plain, personal styling as the comp note and the nudges: no logo
 * lockup, no card, system fonts. It is a note from Rich, not a receipt (the
 * store already sent the receipt), so it has no prices in it either.
 */
export const subscriberWelcomeTemplate = ({
  name,
  isTrial,
  store,
}: SubscriberWelcomeTemplateProps) => {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const textGreeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const opening = openingLine(isTrial);
  const smallCompany =
    "It means a lot. MastersFit is a small company, and there's a real person on the other end of it: me.";
  const manage = manageSubscriptionLine(store);
  const reply =
    "Just reply to this email if anything feels off or you want something changed. It comes straight to me.";

  const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const P = `margin:0 0 16px 0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#1A1A1A;`;

  const benefitsHtml = MASTERSFIT_PLUS_BENEFITS.map(
    (b) =>
      `<li style="margin:0 0 6px 0; font-family:${FONT}; font-size:16px; line-height:1.5; color:#1A1A1A;">${escapeHtml(b).replace(/ — /g, " &mdash; ")}</li>`
  ).join("\n          ");

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />
<title>${SUBSCRIBER_WELCOME_SUBJECT}</title>
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
    ${escapeHtml(opening)} A quick note from me.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="${P}">${greeting}</p>

        <p style="${P}">${escapeHtml(opening)} ${escapeHtml(smallCompany)}</p>

        <p style="margin:0 0 8px 0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#1A1A1A;">Here's what you have now:</p>
        <ul style="margin:0 0 16px 0; padding-left:22px;">
          ${benefitsHtml}
        </ul>

        <p style="${P}">${escapeHtml(manage)}</p>

        <p style="${P}">${escapeHtml(reply)}</p>

        <p style="margin:0; font-family:${FONT}; font-size:16px; line-height:1.6; color:#1A1A1A;">
          &mdash; Rich
        </p>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const text = `${textGreeting}

${opening} ${smallCompany}

Here's what you have now:
${MASTERSFIT_PLUS_BENEFITS.map((b) => `- ${b.replace(/ — /g, " - ")}`).join("\n")}

${manage}

${reply}

- Rich
`;

  return { html, text };
};

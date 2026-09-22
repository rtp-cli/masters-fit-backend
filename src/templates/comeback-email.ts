import { escapeHtml } from "@/templates/email-shared";

interface ComebackTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /**
   * Days since they signed up, used to pick the "you set this up ___" phrase.
   * It has to adapt: this cohort ranges from 8 days to 289, and "a few weeks
   * back" is plainly wrong at both ends. A timeframe a recipient knows to be
   * false is the exact tell that turns a personal note into a mailshot.
   */
  daysSinceSignup: number;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/**
 * The comeback email — for someone who finished setup, got a plan, never
 * started it, and whose plan has since RUN OUT.
 *
 * WHY THIS IS NOT THE ACTIVATION NUDGE AGAIN. That email says "your session is
 * ready", which was true on day two. On 2026-09-22 every person in this cohort
 * had an active plan whose last day was already in the past — by up to 21 days —
 * and five had already received the nudge and ignored it. Its premise had
 * quietly expired.
 *
 * The app agrees with them: with no plan day matching today the workout tab
 * shows "No Active Workout", and the dashboard's plan-ended recap reports days
 * completed, which for every one of these people is zero. A second "come back to
 * your plan" email walks them into a screen saying they did nothing and have
 * nothing scheduled. So this one names the expiry in its second sentence, which
 * is what the app will confirm when they tap through.
 *
 * WHAT THIS EMAIL DELIBERATELY DOES NOT DO: it does not offer to shrink their
 * plan. An earlier draft did, on a theory that the first week looked
 * intimidating. Rich pushed back and he was right — zero logged sets is evidence
 * of not starting, not of why, and "they got distracted" fits the same data at
 * least as well. The copy hands them the controls instead of diagnosing them.
 *
 * It also does not mention any feature. That was Email A's job, and its contents
 * are noise to someone who never did a first workout.
 *
 * ONE LINE IS LOAD-BEARING: "Your complimentary access is still active." Two of
 * the seven recipients had spent every free AI operation they had — ccowdery's
 * ledger showed INITIAL_PLAN 1/1 and WEEK_ADJUSTMENT 1/1 against free limits of
 * exactly 1 each — so from the day their plan expired, every attempt to build a
 * new week hit the paywall. They were locked out, not uninterested. Both were
 * comped on 2026-09-22, which is what makes that sentence true.
 *
 * COMMERCIAL, not transactional: unsubscribe footer, postal address, and the
 * caller must consult `email_opted_out_at` before reaching here.
 */
export const COMEBACK_COPY = {
  /** Rich's own subject. An invitation, not a reprimand. */
  subject: "Still want to give MastersFit a try?",

  /**
   * The grey line after the subject. Leads with the access point rather than
   * the lapse, because for at least two recipients that IS the news.
   */
  preheader:
    "Your complimentary access is still active — nothing to renew or purchase.",

  signoff: "Rich",
} as const;

/**
 * How to refer to when they signed up. Vague on purpose: an exact day count
 * reads as surveillance, and the register here is a note from a person.
 */
function signupPhrase(days: number): string {
  if (days >= 90) return "a while back";
  if (days >= 21) return "a few weeks back";
  if (days >= 12) return "a couple of weeks back";
  return "last week";
}

/** Typographic copy → ASCII, for the text/plain half. */
const toPlain = (s: string): string =>
  s
    .replace(/→/g, "->")
    .replace(/—/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

export const comebackTemplate = ({
  name,
  daysSinceSignup,
  unsubscribeUrl,
  postalAddress,
}: ComebackTemplateProps) => {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  // Rich's own greeting style for this one: "Hi Chris —", not "Hi Chris,".
  const greeting = firstName ? `Hi ${escapeHtml(firstName)} —` : "Hi there —";
  const textGreeting = firstName ? `Hi ${firstName} -` : "Hi there -";

  const when = signupPhrase(daysSinceSignup);

  const body = [
    `Just a quick nudge from me. You set MastersFit up ${when} and got your first plan, but it looks like you never got started on it — and that plan has since run out.`,
    `Your complimentary access is still active, so there's nothing to renew or purchase. Open the app and it'll offer to build you a fresh week.`,
    `If the schedule doesn't fit your life, you can change it yourself — how many days a week, and how long each session. It's under the person icon in the top right, in "Your week".`,
    `And if something got in the way the first time — confusing onboarding, a technical issue, or just life — I'd be interested in hearing that too. That feedback helps me make the app better.`,
    `Hope you'll give it a shot.`,
  ];

  const P =
    "margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;";

  const unsubHref = escapeHtml(unsubscribeUrl);
  const address = escapeHtml(postalAddress).replace(/\r?\n/g, "<br />");

  const bodyHtml = body
    .map((para) => `        <p style="${P}">\n          ${escapeHtml(para)}\n        </p>`)
    .join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />
<title>${escapeHtml(COMEBACK_COPY.subject)}</title>
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
    ${escapeHtml(COMEBACK_COPY.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="${P}">${greeting}</p>

${bodyHtml}

        <p style="margin:0 0 32px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          ${escapeHtml(COMEBACK_COPY.signoff)}
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

${body.map(toPlain).join("\n\n")}

${toPlain(COMEBACK_COPY.signoff)}

---
Unsubscribe from these emails: ${unsubscribeUrl}
${postalAddress}
`;

  return { html, text };
};

/** Re-exported so callers don't reach into the copy block for the subject. */
export const COMEBACK_SUBJECT = COMEBACK_COPY.subject;

import { escapeHtml } from "@/templates/email-shared";

interface ComebackTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /**
   * How many days ago their plan's last day fell. Used to say "a couple of
   * weeks ago" rather than pretending the plan is still waiting for them.
   * Null when it somehow can't be resolved — the copy then omits the clause
   * rather than inventing a timeframe.
   */
  daysSincePlanEnded: number | null;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/**
 * The comeback email — for someone who got a plan, never started it, and whose
 * plan has since RUN OUT.
 *
 * WHY THIS IS NOT THE ACTIVATION NUDGE AGAIN. That email says "your session is
 * ready", which was true on day two. On 2026-09-22, seven of the eight people in
 * this cohort had an active plan whose last day was already in the past — by up
 * to 21 days. The nudge's premise had quietly expired, and five of them had
 * already received it and ignored it.
 *
 * Worse, the app agrees with them: with no plan day matching today, the workout
 * tab shows "No Active Workout", and the dashboard's plan-ended recap reports
 * how many days they finished — which for every one of these people is zero. So
 * a second "come back to your plan" email walks them into a screen that says
 * they did nothing and have nothing scheduled. That is the opposite of a nudge.
 *
 * So this email does three things the nudge cannot:
 *
 *   1. It tells the truth first. The plan expired. Saying so removes the guilt
 *      of an unopened app before making any ask, and it matches what they will
 *      actually see when they tap through.
 *   2. It offers a SMALLER plan, not the same one again. Their profiles asked
 *      for a lot — one asked for seven days a week at sixty minutes, and two
 *      beginners asked for five days a week. A week that size is not a plan you
 *      lapse from, it is a plan you never begin.
 *   3. It asks for ONE session. Not a week, not a habit. The measured failure is
 *      entirely plan-on-screen → first-set-logged, so the only ask that matters
 *      is the first one.
 *
 * It deliberately makes no promise about features, mentions nothing they have
 * missed, and does not reference the feature-tour email — that one went to
 * people who train, and its contents are noise to someone who never started.
 *
 * COMMERCIAL, not transactional: unsubscribe footer, postal address, and the
 * caller must consult `email_opted_out_at` before reaching here.
 */
export const COMEBACK_COPY = {
  /**
   * Subject. Names the real situation rather than performing enthusiasm.
   * "Your plan is waiting" is the line this email exists BECAUSE it stopped
   * being true, so it must not be reused here in any form.
   */
  subject: "Your MastersFit plan ran out — want a smaller one?",

  /**
   * The grey line after the subject. Carries the actual offer, because the
   * subject is a question and the offer is the reason to open.
   */
  preheader: "No catch-up, no guilt. I'll build you a shorter week to start from.",

  signoff: "— Rich",
} as const;

/** Typographic copy → ASCII, for the text/plain half. */
const toPlain = (s: string): string =>
  s
    .replace(/→/g, "->")
    .replace(/—/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

export const comebackTemplate = ({
  name,
  daysSincePlanEnded,
  unsubscribeUrl,
  postalAddress,
}: ComebackTemplateProps) => {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const textGreeting = firstName ? `Hi ${firstName},` : "Hi there,";

  // Vague on purpose. "Your plan ended 14 days ago" is a number that reads as
  // surveillance and as a scolding; "a couple of weeks ago" is the same fact in
  // the register a person would use.
  const when =
    daysSincePlanEnded === null
      ? "a while back"
      : daysSincePlanEnded >= 14
        ? "a couple of weeks ago"
        : daysSincePlanEnded >= 7
          ? "last week"
          : "a few days ago";

  const P =
    "margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;";

  const unsubHref = escapeHtml(unsubscribeUrl);
  const address = escapeHtml(postalAddress).replace(/\r?\n/g, "<br />");

  const body = [
    `The workout plan MastersFit built for you ran out ${when}, and you never got a chance to start it. I'd rather find out why than let it sit there.`,
    `If the week it gave you looked like too much — too many days, too long, too hard — that's worth telling me, and it's the most common reason a plan doesn't get started. I can build you a smaller one. Two days instead of five. Twenty minutes instead of forty-five. Something you'd actually finish.`,
    `You don't have to catch up on anything. The old plan is gone and nothing is counting against you.`,
    `Open the app and it'll offer to build a new week. Or just hit reply and tell me what would work — how many days, how long, what you'd actually want to do — and I'll set it up myself.`,
    `And if MastersFit just isn't for you, that's genuinely useful to know too. One line is plenty.`,
  ];

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

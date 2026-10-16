import {
  firstNameOf,
  personalLayout,
  type RenderedEmail,
} from "@/templates/email-layouts";

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
  /**
   * True when the recipient holds an active COMPLIMENTARY access grant. Picks
   * the third paragraph and the preheader: only a comped reader may be told
   * their complimentary access is still active.
   */
  isComped: boolean;
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
 * comped on 2026-09-22, which is what makes that sentence true. It is now
 * BRANCHED on comp status (`isComped`): a non-comped reader gets only "Open
 * the app and it'll offer to build you a fresh week." and the matching
 * preheader, because the access claim is false for them.
 *
 * Type 1, personal layout (no logo, no button), with the personal variant of
 * the commercial footer.
 *
 * COMMERCIAL, not transactional: unsubscribe footer, postal address, and the
 * caller must consult `email_opted_out_at` before reaching here.
 */
export const COMEBACK_COPY = {
  /** Rich's own subject. An invitation, not a reprimand. */
  subject: "Still want to give MastersFit a try?",

  /**
   * The grey line after the subject. For a comped reader it leads with the
   * access point rather than the lapse, because for them that IS the news.
   */
  preheader: {
    comped:
      "Your complimentary access is still active — nothing to renew or purchase.",
    everyoneElse: "Open the app and it'll offer to build you a fresh week.",
  },

  /** The third paragraph, branched on comp status (SPEC §2, 02 Comeback). */
  freshWeek: {
    comped:
      "Your complimentary access is still active, so there's nothing to renew or purchase. Open the app and it'll offer to build you a fresh week.",
    everyoneElse: "Open the app and it'll offer to build you a fresh week.",
  },

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

export const comebackTemplate = ({
  name,
  daysSinceSignup,
  isComped,
  unsubscribeUrl,
  postalAddress,
}: ComebackTemplateProps): RenderedEmail => {
  const when = signupPhrase(daysSinceSignup);
  const branch = isComped ? "comped" : "everyoneElse";

  const body = [
    `Just a quick nudge from me. You set MastersFit up ${when} and got your first plan, but it looks like you never got started on it — and that plan has since run out.`,
    COMEBACK_COPY.freshWeek[branch],
    `If the schedule doesn't fit your life, you can change it yourself — how many days a week, and how long each session. It's under the person icon in the top right, in "Your week".`,
    `And if something got in the way the first time — confusing onboarding, a technical issue, or just life — I'd be interested in hearing that too. That feedback helps me make the app better.`,
    `Hope you'll give it a shot.`,
  ];

  return personalLayout({
    title: COMEBACK_COPY.subject,
    preheader: COMEBACK_COPY.preheader[branch],
    firstName: firstNameOf(name),
    // Rich's own greeting style for this one: "Hi Chris —", not "Hi Chris,".
    greetingSuffix: " —",
    blocks: body.map((text) => ({ kind: "paragraph" as const, text })),
    signoff: COMEBACK_COPY.signoff,
    footer: { unsubscribeUrl, postalAddress },
  });
};

/** Re-exported so callers don't reach into the copy block for the subject. */
export const COMEBACK_SUBJECT = COMEBACK_COPY.subject;

import {
  firstNameOf,
  personalLayout,
  type EmailBlock,
  type RenderedEmail,
} from "@/templates/email-layouts";

interface FeatureTourTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/** One numbered entry: what it is, where it is, why you'd want it. */
interface FeatureTourItem {
  /** Numbered heading, e.g. "1. Send feedback without leaving the app". */
  head: string;
  /** The tap path, quoted from the shipped UI. The payload of the whole email. */
  path: string;
  /** Why you'd care. */
  body: string;
}

/**
 * EVERY WORD THE READER SEES. Edit the copy here and nowhere else.
 *
 * This block exists because the HTML and plain-text halves used to carry their
 * own full copies of the prose, and keeping two hand-synced transcriptions of
 * the same paragraphs is a drift bug waiting to happen: nothing typechecks the
 * difference, and the mismatch only ever surfaces in a reader's mail client.
 * Both halves are now rendered from this object.
 *
 * Write normal prose with real punctuation — curly apostrophes, em dashes, and
 * → arrows. The layout escapes it for HTML and transliterates it to ASCII for
 * the text half. There is no markup to get right.
 */
export const FEATURE_TOUR_COPY = {
  /**
   * Subject line.
   *
   * Reads like a person rather than a product announcement: no "what's new in
   * MastersFit", which is a newsletter header and gets archived on sight.
   *
   * "You may have missed" puts the fault on the app being easy to miss, not on
   * the reader for not noticing — these are the people who DID show up, and
   * opening by implying they've done it wrong spends the goodwill the feedback
   * request at the bottom then needs.
   */
  subject: "A few MastersFit features you may have missed",

  /**
   * The grey line after the subject in most inboxes. Left unset, clients scrape
   * the greeting instead, which wastes the slot on "Hi Kelly, I've added…".
   * Must never promise something the body doesn't deliver.
   */
  preheader: "Some of the better things in the app are buried. Here's where to find them.",

  /**
   * Deliberately undated. An earlier draft said "since the beginning of
   * September", but items 1 and 2 shipped 2026-07-28 and 2026-08-11 — "lately"
   * is the version that is true for every reader, including the two who have
   * been here since before September.
   */
  intro:
    "I've added quite a bit to MastersFit lately, and I realized some of those features might be easy to miss.",

  lead: "Here are five worth knowing about:",

  /**
   * Every path is verified against the shipped 1.2.2 UI and the labels are
   * quoted as they render: Settings is a PERSON icon, the correction control
   * reads "Edit log", and the repeat door reads "Use a workout I've done
   * before" (NOT "Repeat Past Workout", which MF-022 removed from the UI). A
   * path that is almost right is worse than no email — re-walk them on a device
   * before changing any of these lines.
   */
  items: [
    {
      head: "1. Send feedback without leaving the app",
      path: "Tap the person icon → Feedback.",
      body: "Bug, idea, confusing screen, something that annoys you — send it there. You can even dictate instead of typing. It includes your app version and device info by default, which makes it much easier for me to track down problems.",
    },
    {
      head: "2. Fix a workout log after the fact",
      path: "Go to Calendar → tap any completed workout → Edit log.",
      body: "Wrong weight? Missed a set? Marked something complete that you skipped? You can go back and fix it anytime.",
    },
    {
      head: "3. Repeat a workout you liked",
      path: "Go to Calendar → select an upcoming workout → Change Workout → Use a workout I've done before.",
      body: "MastersFit will replace that day with one of your previous workouts.",
    },
    {
      // LR-069. MastersFit+ only, enforced server-side — every intended
      // recipient is complimentary or subscribed, so the tier is deliberately
      // not mentioned. Check that still holds before adding anyone new.
      head: "4. Add a second workout on a day you've already trained",
      path: "Finish today's workout, then tap + Add another workout.",
      body: "Tell it what you want to work on and how long you've got, and it builds a second session for today. Two sessions a day is the limit.",
    },
    {
      // Singular on purpose. Every other line reads one-to-one, and a stray
      // "some of you" is the one word that tells the reader they're on a list.
      head: "5. Walking & Movement is now a workout type",
      path: "Person icon → Preferred Workout Types → Walking & Movement, then rebuild your week.",
      body: "This one is new since you originally set up your profile. If you want walking, easy hills, or lighter movement mixed into your programming, that's where to turn it on.",
    },
  ] as FeatureTourItem[],

  close: [
    "And please use in-app feedback aggressively. I read everything that comes through it, and it moves to the front of the line. If something is confusing, hard to find, doesn't work, or just doesn't feel right, I want to know.",
    "There's more coming soon — stay tuned!",
    "Thanks again for helping me beat on this thing.",
  ],

  signoff: "— Rich",
} as const;

/**
 * The feature tour — to the handful of people who have actually trained with
 * the app.
 *
 * Deliberately NOT sent to the never-activated. Someone who has never logged a
 * set does not need to hear about correcting a log; they need the activation
 * nudge next door, and they already got it. Mixing the two audiences produces
 * an email that is wrong for both.
 *
 * Type 1, personal layout — deliberately NOT branded: at a handful of
 * recipients who all know Rich by name, a plain message from a person
 * outperforms a designed one. The moment this grows a logo lockup and a hero
 * image it becomes a newsletter, and newsletters get archived unread.
 *
 * Each tip renders as a bold title, then the tap path on its own muted line
 * directly under it (SPEC §2), then the explanation — the whole premise of the
 * email is "you didn't know where this was", so the path has to be findable.
 *
 * COMMERCIAL, not transactional: the personal variant of the unsubscribe +
 * postal address footer, and the caller must consult `email_opted_out_at`
 * before reaching here.
 */
export const featureTourTemplate = ({
  name,
  unsubscribeUrl,
  postalAddress,
}: FeatureTourTemplateProps): RenderedEmail => {
  const c = FEATURE_TOUR_COPY;
  const blocks: EmailBlock[] = [
    { kind: "paragraph", text: c.intro },
    { kind: "paragraph", text: c.lead },
    ...c.items.map(
      (item): EmailBlock => ({
        kind: "tip",
        title: item.head,
        path: item.path,
        body: item.body,
      })
    ),
    ...c.close.map((text): EmailBlock => ({ kind: "paragraph", text })),
  ];

  return personalLayout({
    title: c.subject,
    preheader: c.preheader,
    firstName: firstNameOf(name),
    blocks,
    signoff: c.signoff,
    footer: { unsubscribeUrl, postalAddress },
  });
};

/** Re-exported so callers don't reach into the copy block for the subject. */
export const FEATURE_TOUR_SUBJECT = FEATURE_TOUR_COPY.subject;

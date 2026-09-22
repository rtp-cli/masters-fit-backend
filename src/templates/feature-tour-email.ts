import { escapeHtml } from "@/templates/email-shared";

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
  /** Why you'd care. Set muted, so the path above wins the eye on a skim. */
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
 * → arrows. The HTML half escapes it; the text half transliterates to ASCII.
 * There is no markup to get right.
 */
export const FEATURE_TOUR_COPY = {
  /**
   * Subject line.
   *
   * Takes the opening sentence's own framing rather than inventing one: the
   * email says the good features are easy to miss, so the subject says exactly
   * that. "What's new in MastersFit" is a newsletter header and gets archived
   * on sight; this is a claim the reader can check in ten seconds.
   *
   * Deliberately not "you're missing out" — these people are the ones who DID
   * show up, and opening by implying they've done it wrong spends the goodwill
   * the feedback request at the bottom then needs.
   */
  subject: "Five MastersFit features that are too easy to miss",

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
 * Typographic copy → ASCII, for the text/plain half.
 *
 * The clients most likely to render text/plain are the ones least likely to
 * have good glyph coverage, and every existing template in this directory
 * already spells these as ASCII. Applied at render time so the copy block above
 * can stay readable prose.
 */
const toPlain = (s: string): string =>
  s
    .replace(/→/g, "->")
    .replace(/—/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

/**
 * "Five features that are too easy to miss" — to the handful of people who
 * have actually trained with the app.
 *
 * Deliberately NOT sent to the never-activated. Someone who has never logged a
 * set does not need to hear about correcting a log; they need the activation
 * nudge next door, and they already got it. Mixing the two audiences produces
 * an email that is wrong for both.
 *
 * Same undesigned note styling as the activation nudge and the comp email, and
 * for the same reason: at a handful of recipients who all know Rich by name, a
 * plain message from a person outperforms a designed one. The moment this grows
 * a logo lockup and a hero image it becomes a newsletter, and newsletters get
 * archived unread.
 *
 * Each item renders as three lines, with the tap path carrying the weight: the
 * whole premise of the email is "you didn't know where this was", so the path
 * is the payload and the explanation under it is muted to let the path win.
 *
 * COMMERCIAL, not transactional: unsubscribe footer, postal address, and the
 * caller must consult `email_opted_out_at` before reaching here.
 */
export const featureTourTemplate = ({
  name,
  unsubscribeUrl,
  postalAddress,
}: FeatureTourTemplateProps) => {
  const c = FEATURE_TOUR_COPY;
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const textGreeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const P =
    "margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;";
  // The three lines of an item are one unit: tight leading between them, a
  // full gap after. Heading and path stay full-contrast; the explanation is
  // muted so the path is what the eye lands on when this is skimmed.
  const ITEM_HEAD =
    "margin:0 0 2px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.5; color:#1A1A1A;";
  const ITEM_PATH =
    "margin:0 0 2px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.5; color:#1A1A1A;";
  const ITEM_BODY =
    "margin:0 0 22px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#5A5A5A;";

  const unsubHref = escapeHtml(unsubscribeUrl);
  // Escape FIRST, then turn newlines into breaks — the other order would escape
  // the <br> tags.
  const address = escapeHtml(postalAddress).replace(/\r?\n/g, "<br />");

  const itemsHtml = c.items
    .map(
      (item) => `        <p style="${ITEM_HEAD}"><strong>${escapeHtml(item.head)}</strong></p>
        <p style="${ITEM_PATH}">${escapeHtml(item.path)}</p>
        <p style="${ITEM_BODY}">
          ${escapeHtml(item.body)}
        </p>`
    )
    .join("\n\n");

  const closeHtml = c.close
    .map(
      (para) => `        <p style="${P}">
          ${escapeHtml(para)}
        </p>`
    )
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
<title>${escapeHtml(c.subject)}</title>
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
    ${escapeHtml(c.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="${P}">${greeting}</p>

        <p style="${P}">
          ${escapeHtml(c.intro)}
        </p>

        <p style="${P}">${escapeHtml(c.lead)}</p>

${itemsHtml}

${closeHtml}

        <p style="margin:0 0 32px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;">
          ${escapeHtml(c.signoff)}
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

  const itemsText = c.items
    .map((item) => `${toPlain(item.head)}\n${toPlain(item.path)}\n${toPlain(item.body)}`)
    .join("\n\n");

  const closeText = c.close.map(toPlain).join("\n\n");

  const text = `${textGreeting}

${toPlain(c.intro)}

${toPlain(c.lead)}

${itemsText}

${closeText}

${toPlain(c.signoff)}

---
Unsubscribe from these emails: ${unsubscribeUrl}
${postalAddress}
`;

  return { html, text };
};

/** Re-exported so callers don't reach into the copy block for the subject. */
export const FEATURE_TOUR_SUBJECT = FEATURE_TOUR_COPY.subject;

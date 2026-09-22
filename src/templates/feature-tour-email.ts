import { escapeHtml } from "@/templates/email-shared";

interface FeatureTourTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/**
 * "Six features that are too easy to miss" — to the handful of people who
 * have actually trained with the app.
 *
 * Deliberately NOT sent to the never-activated. Someone who has never logged a
 * set does not need to hear about correcting a log; they need the activation
 * nudge next door, and they already got it. Mixing the two audiences produces
 * an email that is wrong for both.
 *
 * Same undesigned note styling as the activation nudge and the comp email, and
 * for the same reason: at six recipients who all know Rich by name, a plain
 * message from a person outperforms a designed one. The moment this grows a
 * logo lockup and a hero image it becomes a newsletter, and newsletters get
 * archived unread.
 *
 * Each item is three lines — what it is, where it is, why you'd want it — and
 * the middle line carries the weight. The whole premise of the email is "you
 * didn't know where this was", so the tap path is the payload; the explanation
 * under it is set muted precisely so the path wins the eye.
 *
 * Every path is verified against the shipped 1.2.2 UI and the labels are quoted
 * as they render: Settings is a PERSON icon, the correction control reads
 * "Edit log", the share control reads "Share workout", and the repeat door
 * reads "Use a workout I've done before" (NOT "Repeat Past Workout", which
 * MF-022 removed from the UI). A path that is almost right is worse than no
 * email.
 *
 * COMMERCIAL, not transactional: unsubscribe footer, postal address, and the
 * caller must consult `email_opted_out_at` before reaching here.
 */
export const featureTourTemplate = ({
  name,
  unsubscribeUrl,
  postalAddress,
}: FeatureTourTemplateProps) => {
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

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />
<title>Six features that are too easy to miss</title>
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
    Six things worth knowing about &mdash; including how to send me feedback without leaving the app.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="${P}">${greeting}</p>

        <p style="${P}">
          I&rsquo;ve added quite a bit to MastersFit over the last few releases, and I realized some of the better features are a little too easy to miss.
        </p>

        <p style="${P}">Here are six worth knowing about:</p>

        <p style="${ITEM_HEAD}"><strong>1. Send feedback without leaving the app</strong></p>
        <p style="${ITEM_PATH}">Tap the person icon &rarr; Feedback.</p>
        <p style="${ITEM_BODY}">
          Bug, idea, confusing screen, something that annoys you &mdash; send it there. You can even dictate instead of typing. It automatically includes your app version and device info, which makes it much easier for me to track down problems.
        </p>

        <p style="${ITEM_HEAD}"><strong>2. Fix a workout log after the fact</strong></p>
        <p style="${ITEM_PATH}">Go to Calendar &rarr; tap any completed workout &rarr; Edit log.</p>
        <p style="${ITEM_BODY}">
          Wrong weight? Missed a set? Marked something complete that you skipped? You can go back and fix it anytime.
        </p>

        <p style="${ITEM_HEAD}"><strong>3. Repeat a workout you liked</strong></p>
        <p style="${ITEM_PATH}">Go to Calendar &rarr; select an upcoming workout &rarr; Change Workout &rarr; Use a workout I&rsquo;ve done before.</p>
        <p style="${ITEM_BODY}">
          MastersFit will replace that day with one of your previous workouts.
        </p>

        <p style="${ITEM_HEAD}"><strong>4. Share a completed workout</strong></p>
        <p style="${ITEM_PATH}">Open a completed workout and tap Share workout.</p>
        <p style="${ITEM_BODY}">
          MastersFit creates a shareable card, and you can choose whether to include your results and streak.
        </p>

        <p style="${ITEM_HEAD}"><strong>5. Add a second workout on a day you&rsquo;ve already trained</strong></p>
        <p style="${ITEM_PATH}">Finish today&rsquo;s workout, then tap + Add another workout.</p>
        <p style="${ITEM_BODY}">
          Tell it what you want to work on and how long you&rsquo;ve got, and it builds a second session for today. Two sessions a day is the limit.
        </p>

        <p style="${ITEM_HEAD}"><strong>6. Walking &amp; Movement is now a workout type</strong></p>
        <p style="${ITEM_PATH}">Person icon &rarr; Preferred Workout Types &rarr; Walking &amp; Movement, then rebuild your week.</p>
        <p style="${ITEM_BODY}">
          This one is new since some of you originally set up your profiles. If you want walking, easy hills, or lighter movement mixed into your programming, that&rsquo;s where to turn it on.
        </p>

        <p style="${P}">
          And please use the feedback button aggressively. If something is confusing, hard to find, doesn&rsquo;t work, or just feels dumb, I want to know.
        </p>

        <p style="${P}">
          Thanks again for helping me beat on this thing.
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

I've added quite a bit to MastersFit over the last few releases, and I realized some of the better features are a little too easy to miss.

Here are six worth knowing about:

1. Send feedback without leaving the app
Tap the person icon -> Feedback.
Bug, idea, confusing screen, something that annoys you - send it there. You can even dictate instead of typing. It automatically includes your app version and device info, which makes it much easier for me to track down problems.

2. Fix a workout log after the fact
Go to Calendar -> tap any completed workout -> Edit log.
Wrong weight? Missed a set? Marked something complete that you skipped? You can go back and fix it anytime.

3. Repeat a workout you liked
Go to Calendar -> select an upcoming workout -> Change Workout -> Use a workout I've done before.
MastersFit will replace that day with one of your previous workouts.

4. Share a completed workout
Open a completed workout and tap Share workout.
MastersFit creates a shareable card, and you can choose whether to include your results and streak.

5. Add a second workout on a day you've already trained
Finish today's workout, then tap + Add another workout.
Tell it what you want to work on and how long you've got, and it builds a second session for today. Two sessions a day is the limit.

6. Walking & Movement is now a workout type
Person icon -> Preferred Workout Types -> Walking & Movement, then rebuild your week.
This one is new since some of you originally set up your profiles. If you want walking, easy hills, or lighter movement mixed into your programming, that's where to turn it on.

And please use the feedback button aggressively. If something is confusing, hard to find, doesn't work, or just feels dumb, I want to know.

Thanks again for helping me beat on this thing.

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
 * Taken from the opening sentence's own framing rather than invented: the email
 * says the good features are easy to miss, so the subject says exactly that.
 * "What's new in MastersFit" is a newsletter header and gets archived on sight;
 * this is a claim the reader can check in ten seconds.
 *
 * Deliberately not "you're missing out" — these people are the ones who DID
 * show up, and an email that opens by implying they've done it wrong spends the
 * goodwill the feedback request at the bottom then needs.
 */
export const FEATURE_TOUR_SUBJECT =
  "Six MastersFit features that are too easy to miss";

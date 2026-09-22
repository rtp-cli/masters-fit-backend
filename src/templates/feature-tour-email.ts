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
 * "Four things you probably haven't found" — to the handful of people who have
 * ACTUALLY used the app.
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
 * The one concession to structure is the bolded lead-in plus a muted path line
 * per item. The whole premise of the email is "you didn't know where this was",
 * so the exact tap path is the payload — burying it inside a paragraph would
 * reproduce the very problem the email exists to fix.
 *
 * Every path below is verified against the shipped 1.2.2 UI, and the labels are
 * quoted exactly as they render. Settings is a PERSON icon, not a gear. The
 * repeat door reads "Use a workout I've done before", not "Repeat Past
 * Workout". A path that is almost right is worse than no email.
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
  // Item lead-in sits tight to its path line, so the pair reads as one unit.
  const ITEM =
    "margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#1A1A1A;";
  const PATH =
    "margin:0 0 20px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#5A5A5A;";

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
<title>Four things you probably haven't found</title>
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
    Four things already in the app that almost nobody has found.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr>
      <td align="left" class="wrap" style="padding:40px 32px; max-width:560px;">

        <p style="${P}">${greeting}</p>

        <p style="${P}">
          You're one of the few people actually training with MastersFit, which makes you the right person to send this to.
        </p>

        <p style="${P}">
          There are four things already in the app that almost nobody has found. None of them are new &mdash; they're just buried, which is my fault rather than yours.
        </p>

        <p style="${ITEM}"><strong>1. Tell me something's wrong without leaving the app.</strong></p>
        <p style="${PATH}">
          Person icon, top right &rarr; Feedback. A bug, an idea, or just "this annoyed me". You can talk it instead of typing it. It lands in my inbox with your app version and phone attached, so I can actually chase it.
        </p>

        <p style="${ITEM}"><strong>2. Fix a log you got wrong.</strong></p>
        <p style="${PATH}">
          Calendar &rarr; tap any completed day &rarr; "Edit log" under the summary. Any past day, not just today's. Wrong weight, a set you forgot to tick, something marked done that you actually skipped.
        </p>

        <p style="${ITEM}"><strong>3. Do a workout you liked again.</strong></p>
        <p style="${PATH}">
          Calendar &rarr; tap an upcoming day &rarr; Change Workout &rarr; "Use a workout I've done before". It replaces that day with one you've already completed.
        </p>

        <p style="${ITEM}"><strong>4. Share a workout you're pleased with.</strong></p>
        <p style="${PATH}">
          Same row as Edit log &mdash; "Share workout" under a completed day. It makes a card you can send or save, and you choose whether your numbers and your streak are on it.
        </p>

        <p style="${P}">
          One more, because it arrived after you set your profile up: <strong>Walking &amp; Movement</strong> is now a training style of its own &mdash; walks, easy hills, gentle movement. If you want some of that in the mix, it's Person icon &rarr; Preferred Workout Types, then rebuild the week.
        </p>

        <p style="${P}">
          If any of this doesn't work the way I've just described it, that's exactly what number 1 is for. Or just hit reply &mdash; it comes straight to me.
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

You're one of the few people actually training with MastersFit, which makes you the right person to send this to.

There are four things already in the app that almost nobody has found. None of them are new - they're just buried, which is my fault rather than yours.

1. Tell me something's wrong without leaving the app.
Person icon, top right -> Feedback. A bug, an idea, or just "this annoyed me". You can talk it instead of typing it. It lands in my inbox with your app version and phone attached, so I can actually chase it.

2. Fix a log you got wrong.
Calendar -> tap any completed day -> "Edit log" under the summary. Any past day, not just today's. Wrong weight, a set you forgot to tick, something marked done that you actually skipped.

3. Do a workout you liked again.
Calendar -> tap an upcoming day -> Change Workout -> "Use a workout I've done before". It replaces that day with one you've already completed.

4. Share a workout you're pleased with.
Same row as Edit log - "Share workout" under a completed day. It makes a card you can send or save, and you choose whether your numbers and your streak are on it.

One more, because it arrived after you set your profile up: Walking & Movement is now a training style of its own - walks, easy hills, gentle movement. If you want some of that in the mix, it's Person icon -> Preferred Workout Types, then rebuild the week.

If any of this doesn't work the way I've just described it, that's exactly what number 1 is for. Or just hit reply - it comes straight to me.

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
 * Names a specific, countable payoff rather than announcing itself as news.
 * "What's new in MastersFit" is a newsletter header and gets archived on sight;
 * "Four things you probably haven't found" is a claim about the reader that
 * they can check in ten seconds, which is the whole reason to open it.
 *
 * Deliberately not "you're missing out" — these people are the ones who DID
 * show up, and an email that opens by implying they've done it wrong spends
 * goodwill that the reply request at the bottom then needs.
 */
export const FEATURE_TOUR_SUBJECT =
  "Four things in MastersFit you probably haven't found";

import {
  firstNameOf,
  nudgeLayout,
  type RenderedEmail,
} from "@/templates/email-layouts";

interface ActivationNudgeTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /** Their active plan's name, e.g. "Advanced Full-Body Strength". */
  planName: string;
  /**
   * The session the email points at, e.g. "Full-Body Strength". Null when the
   * plan has no incomplete day left, in which case the copy falls back to
   * naming the plan instead of printing an empty string.
   */
  firstSessionName: string | null;
  /** Where "Start your first workout" points — a web page, never a scheme. */
  startUrl: string;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/**
 * The activation nudge — for someone whose plan is built and untouched.
 *
 * Type 3, product & marketing: From "MastersFit" on the nudge layout — logo
 * header, the short message, one outlined button to /open, then "A note from
 * Rich" (so no "— MastersFit" sign-off), then the unsubscribe + postal address
 * footer.
 *
 * The one thing this email must do that a generic "come back" cannot: name the
 * actual session waiting for them. The plan is already built — the whole point
 * is that there is a specific, concrete thing to go and do, not a chore to
 * resume. "Your Full-Body Strength session is ready" is a different proposition
 * from "you haven't worked out yet".
 */
export const activationNudgeTemplate = ({
  name,
  planName,
  firstSessionName,
  startUrl,
  unsubscribeUrl,
  postalAddress,
}: ActivationNudgeTemplateProps): RenderedEmail => {
  // Fall back to the plan name when no incomplete day resolved, so the sentence
  // still names something real rather than trailing off.
  const session = firstSessionName?.trim() || planName?.trim() || "";
  const opening = session
    ? `Your ${session} session is built and waiting in the app. You haven't started it yet.`
    : "Your plan is built and waiting in the app. You haven't started it yet.";

  return nudgeLayout({
    title: ACTIVATION_NUDGE_SUBJECT,
    preheader: "Your plan is built — the first session takes one tap to start.",
    firstName: firstNameOf(name),
    paragraphs: [
      opening,
      "There's nothing to set up and nothing to decide. Open the app, tap Start, and it walks you through one exercise at a time. You can stop partway and it keeps what you did.",
    ],
    button: { label: "Start your first workout", href: startUrl },
    note: {
      text: "If the plan isn't right — too long, too hard, wrong equipment — just reply and tell me. I'd rather fix it than have you not use it.",
    },
    unsubscribeUrl,
    postalAddress,
  });
};

/**
 * Subject line.
 *
 * Names the thing that already exists rather than the absence of action. "You
 * haven't worked out yet" is an accusation and reads as a chore; this says
 * there is something built and ready, which is the honest and more inviting
 * framing of the same fact.
 */
export const ACTIVATION_NUDGE_SUBJECT = "Your first session is ready";

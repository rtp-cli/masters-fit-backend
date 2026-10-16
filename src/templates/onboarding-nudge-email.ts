import {
  firstNameOf,
  nudgeLayout,
  type RenderedEmail,
} from "@/templates/email-layouts";

interface OnboardingNudgeTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /** Where "Finish setting up" points — a web page, never a custom scheme. */
  continueUrl: string;
  /** Fully-built unsubscribe link, token already signed. */
  unsubscribeUrl: string;
  /** Postal address for the CAN-SPAM footer. Required by the caller. */
  postalAddress: string;
}

/**
 * The onboarding nudge.
 *
 * Type 3, product & marketing: From "MastersFit" on the nudge layout — logo
 * header, the short message, one outlined button, then "A note from Rich"
 * carrying the reply invitation (so no "— MastersFit" sign-off), then the
 * unsubscribe + postal address footer.
 *
 * The reply invitation is the real payload. One "here's why I bailed" answer is
 * worth more right now than the conversion is.
 */
export const onboardingNudgeTemplate = ({
  name,
  continueUrl,
  unsubscribeUrl,
  postalAddress,
}: OnboardingNudgeTemplateProps): RenderedEmail =>
  nudgeLayout({
    title: ONBOARDING_NUDGE_SUBJECT,
    preheader:
      "You started setting up MastersFit but didn't finish — it takes about two minutes.",
    firstName: firstNameOf(name),
    paragraphs: [
      "You started setting up MastersFit a couple of days ago but didn't make it to the end, so you haven't got your first plan yet.",
      "It takes about two minutes to finish: a few questions about your goals, your schedule, and what equipment you've got. Then it builds your week.",
    ],
    button: { label: "Finish setting up", href: continueUrl },
    note: {
      text: "If something got in the way — confusing, broken, not what you expected — just hit reply and tell me. I read every one.",
    },
    unsubscribeUrl,
    postalAddress,
  });

/**
 * Subject line.
 *
 * The draft this shipped from read "Want me to finish setting this up?", which
 * invites a reply but promises something the sender can't actually do — nobody
 * can finish your profile for you. This one says what's on the other side of
 * the click instead.
 */
export const ONBOARDING_NUDGE_SUBJECT = "You're two minutes from your first plan";

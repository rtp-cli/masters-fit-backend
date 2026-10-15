import {
  firstNameOf,
  welcomeLayout,
  type EmailBlock,
} from "@/templates/email-layouts";

export interface SubscriberWelcomeTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /**
   * True when the subscription started as a free trial. Changes ONE sentence:
   * a trial customer has not been charged, so nothing may say they were.
   */
  isTrial: boolean;
  /** Where "Open MastersFit" points. Must be https — Gmail blocks app schemes. */
  openAppUrl: string;
}

export const SUBSCRIBER_WELCOME_SUBJECT = "Welcome to MastersFit+";

/**
 * Where the "Open MastersFit" button points by default.
 *
 * The website's /continue page: over https (Gmail strips custom schemes like
 * masters-fit://), it hops into the app via the scheme and falls back to the
 * App Store / Google Play buttons. The app has no universal links / associated
 * domains, so there is no https URL that opens it directly. An onboarded user
 * who lands on the app's onboarding route is redirected to the dashboard.
 */
export function subscriberWelcomeOpenAppUrl(): string {
  return (
    process.env.SUBSCRIBER_WELCOME_OPEN_URL ||
    "https://www.mastersfit.ai/continue"
  ).replace(/\/$/, "");
}

/**
 * What a subscriber gets — Rich's approved wording (2026-10). Each line maps to
 * a real free-vs-Plus difference (frontend `constants/access-policy.ts`); this
 * email must never promise something the paywall doesn't.
 */
export const MASTERSFIT_PLUS_BENEFITS = [
  {
    lead: "Training that adapts:",
    text: "Generate new plans and adjust your workouts as your schedule, equipment, or goals change.",
  },
  {
    lead: "Progress you can see:",
    text: "Track strength trends, training volume, and personal records.",
  },
  {
    lead: "Connected workout tracking:",
    text: "Sync your workouts with Apple Health or Health Connect.",
  },
] as const;

/** The opening line. The only sentence that differs for a free trial. */
export function openingLine(isTrial: boolean): string {
  return isTrial
    ? "Thanks for starting your MastersFit+ free trial. Nothing has been charged yet."
    : "Thanks for subscribing to MastersFit+.";
}

/**
 * "Welcome to MastersFit+" — sent to the CUSTOMER right after a paid
 * subscription (or free trial) starts: a production INITIAL_PURCHASE.
 *
 * Type 2, welcome / relationship: From "MastersFit", Reply-To Rich, signed
 * "— Rich / Founder, MastersFit". TRANSACTIONAL — it confirms a change the
 * customer just made to their own account — so no unsubscribe link or postal
 * address, and the caller does not consult `email_opted_out_at`. No prices
 * (the store already sent the receipt).
 */
export const subscriberWelcomeTemplate = ({
  name,
  isTrial,
  openAppUrl,
}: SubscriberWelcomeTemplateProps) => {
  const opening = openingLine(isTrial);

  const blocks: EmailBlock[] = [
    {
      kind: "paragraph",
      text: `${opening} We're glad to be part of your training.`,
    },
    {
      kind: "paragraph",
      text: "MastersFit is built to help you stay strong, active, and consistent after 40—with training that fits your goals, experience, and life.",
    },
    {
      kind: "bullets",
      intro: "Your subscription gives you more flexibility and insight along the way:",
      items: MASTERSFIT_PLUS_BENEFITS.map((b) => ({ lead: b.lead, text: b.text })),
    },
    {
      kind: "paragraph",
      lead: "Your next step:",
      text: "Open MastersFit, review your current plan, and choose your next workout. Keep your profile up to date so your training reflects where you are today.",
    },
    { kind: "button", label: "Open MastersFit", href: openAppUrl },
    {
      kind: "paragraph",
      text: "If you have questions, run into an issue, or have feedback, just reply to this email. We'd like to hear from you.",
    },
    { kind: "paragraph", text: "Thanks for choosing MastersFit." },
  ];

  return welcomeLayout({
    title: SUBSCRIBER_WELCOME_SUBJECT,
    preheader: `${opening} Here's how to get the most from it.`,
    firstName: firstNameOf(name),
    blocks,
  });
};

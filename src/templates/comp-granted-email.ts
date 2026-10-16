import {
  firstNameOf,
  personalLayout,
  type RenderedEmail,
} from "@/templates/email-layouts";

interface CompGrantedTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
}

/**
 * "I've comped your account" — sent when a user is granted COMPLIMENTARY access.
 *
 * Type 1, personal: a note from Rich on the personal layout (no logo, no
 * button, his text signature). TRANSACTIONAL — it tells someone their account
 * changed, which puts it in the same category as a receipt: no unsubscribe
 * link, no postal address, and the caller deliberately does NOT check
 * `email_opted_out_at` — opting out of setup reminders should not stop us
 * telling you your access changed.
 *
 * Deliberately does NOT promise permanence. A comp has no expiry but is a single
 * revocable column, and "free forever" is a promise that outlives the decision.
 */
export const compGrantedTemplate = ({
  name,
}: CompGrantedTemplateProps): RenderedEmail =>
  personalLayout({
    title: COMP_GRANTED_SUBJECT,
    preheader:
      "I've upgraded your account to MastersFit+ — no charge, nothing to do.",
    firstName: firstNameOf(name),
    blocks: [
      "Thanks for giving MastersFit a try. I've upgraded your account to MastersFit+ — no charge, and nothing you need to do.",
      "That means no paywall and no limits on building or adjusting workouts: the same access a paying member gets.",
      "One thing worth knowing — if the app is open right now, close it all the way and reopen it. It checks your access level when it starts up, so the upgrade won't show until it does.",
      "If anything looks wrong, or you've got thoughts on the app, just hit reply. I read every one.",
    ].map((text) => ({ kind: "paragraph" as const, text })),
    signoff: "— Rich",
  });

export const COMP_GRANTED_SUBJECT = "You're on MastersFit+, on me";

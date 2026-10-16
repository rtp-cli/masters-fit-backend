import { Resend } from "resend";
import { otpEmailTemplate, otpEmailSubject } from "@/templates/otp-email";
import { renewalReminderTemplate } from "@/templates/renewal-reminder-email";
import {
  newUserNotificationTemplate,
  type NewUserNotificationTemplateProps,
} from "@/templates/new-user-notification-email";
import {
  stalledSignupDigestTemplate,
  type StalledSignupDigestTemplateProps,
} from "@/templates/stalled-signup-digest-email";
import {
  onboardingNudgeTemplate,
  ONBOARDING_NUDGE_SUBJECT,
} from "@/templates/onboarding-nudge-email";
import {
  activationNudgeTemplate,
  ACTIVATION_NUDGE_SUBJECT,
} from "@/templates/activation-nudge-email";
import { activationStartUrl } from "@/constants/activation-nudge";
import {
  featureTourTemplate,
  FEATURE_TOUR_SUBJECT,
} from "@/templates/feature-tour-email";
import {
  comebackTemplate,
  COMEBACK_SUBJECT,
} from "@/templates/comeback-email";
import {
  compGrantedTemplate,
  COMP_GRANTED_SUBJECT,
} from "@/templates/comp-granted-email";
import {
  subscriberWelcomeTemplate,
  type SubscriberWelcomeTemplateProps,
} from "@/templates/subscriber-welcome-email";
import {
  subscriptionAlertTemplate,
  type SubscriptionAlertTemplateProps,
} from "@/templates/subscription-alert-email";
import { signupNotifyRecipients } from "@/constants/signup-notifications";
import {
  onboardingContinueUrl,
  publicApiUrl,
} from "@/constants/onboarding-nudge";
import { signUnsubscribeToken } from "@/utils/email-token";
import { logger } from "@/utils/logger";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || "system@alif.care";
// Every customer email invites a reply, so Reply-To is always a mailbox a
// person reads.
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || "rtp@mastersfit.ai";

// The personal notes (type 1: comp, comeback, feature tour) are signed by a
// person, so they send as one. The address must still live on the
// Resend-verified domain (updates.mastersfit.ai) or the send is rejected —
// hence rtp@ THERE, with Reply-To pointing at the real mailbox that a human
// actually reads.
const NUDGE_FROM_NAME = process.env.NUDGE_FROM_NAME || "Rich Pusateri";
const NUDGE_FROM_EMAIL =
  process.env.NUDGE_FROM_EMAIL || "rtp@updates.mastersfit.ai";
const NUDGE_REPLY_TO = process.env.NUDGE_REPLY_TO || "rtp@mastersfit.ai";

// Early-phase owner visibility: Rich gets a Bcc on every LIFECYCLE email — the
// ones that reach a real customer because of where they are in their
// relationship with us, not because they asked for something (the onboarding
// nudge, the comp note, the renewal reminder). Nothing should land in a
// member's inbox that he hasn't seen.
//
// NOT on the OTP (one a minute, and he can't act on it), and not on the
// internal alerts, which already come to him. Set LIFECYCLE_BCC_EMAIL to an
// empty string in Render to turn it off without a deploy.
const LIFECYCLE_BCC_EMAIL = (
  process.env.LIFECYCLE_BCC_EMAIL ?? "rtp@mastersfit.ai"
).trim();

/**
 * Bcc for a user-facing lifecycle send, or undefined when there's nothing to
 * add. Skipped when the recipient IS the Bcc address, so comping/nudging Rich's
 * own account doesn't deliver him two copies.
 */
const lifecycleBcc = (to: string): string[] | undefined =>
  LIFECYCLE_BCC_EMAIL &&
  to.trim().toLowerCase() !== LIFECYCLE_BCC_EMAIL.toLowerCase()
    ? [LIFECYCLE_BCC_EMAIL]
    : undefined;

// Triage inboxes — Google Workspace Groups forwarding to a real person.
// On To (never Bcc): Bcc strips the alias the Gmail filters key on.
const FEEDBACK_INBOX = "feedback@mastersfit.ai";
const BUG_INBOX = "bug@mastersfit.ai";

interface RenewalReminderEmailParams {
  to: string;
  name: string;
  /** "annual" | "monthly" */
  planLabel: string;
  /** Formatted price, e.g. "$89.99", or null when the plan is unknown. */
  price: string | null;
  /** Formatted renewal date, e.g. "August 12, 2026". */
  renewalDate: string;
  manageUrl: string;
}

interface FeedbackEmailParams {
  feedbackId: number;
  category: "bug" | "idea" | "praise" | "other";
  message: string;
  userName: string | null;
  userEmail: string | null;
  diagnostics: Record<string, unknown> | null;
}

export class EmailService {
  async sendOtpEmail(to: string, otp: string, name: string) {
    try {
      logger.info("Sending OTP email", {
        operation: "sendOtpEmail",
        metadata: { recipient: to, name },
      });

      const { html, text } = otpEmailTemplate({ otp, name });

      const response = await resend.emails.send({
        from: `MastersFit <${FROM_EMAIL}>`,
        to,
        subject: otpEmailSubject(otp),
        html,
        text,
        replyTo: REPLY_TO_EMAIL,
      });

      if (response.error) {
        logger.error("Email service responded with error", undefined, {
          operation: "sendOtpEmail",
          metadata: { recipient: to, error: response.error },
        });
        throw new Error(`Resend error: ${response.error.message}`);
      }

      logger.info("OTP email sent successfully", {
        operation: "sendOtpEmail",
        metadata: { recipient: to, messageId: response.data?.id },
      });
    } catch (error) {
      logger.error("Failed to send OTP email", error as Error, {
        operation: "sendOtpEmail",
        metadata: { recipient: to },
      });
      throw new Error("Failed to send OTP email");
    }
  }

  /**
   * Send a pre-renewal reminder so an auto-renewal is never a silent surprise.
   * Throws on send failure so the caller can leave the reminder unclaimed and
   * retry on a later scan.
   */
  async sendRenewalReminderEmail(
    params: RenewalReminderEmailParams,
  ): Promise<void> {
    const { to, name, planLabel, price, renewalDate, manageUrl } = params;

    const { html, text } = renewalReminderTemplate({
      name,
      planLabel,
      price,
      renewalDate,
      manageUrl,
    });

    const response = await resend.emails.send({
      from: `MastersFit <${FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: `Your MastersFit+ renews on ${renewalDate}`,
      html,
      text,
      replyTo: REPLY_TO_EMAIL,
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Renewal reminder email sent", {
      operation: "sendRenewalReminderEmail",
      metadata: {
        recipient: to,
        planLabel,
        renewalDate,
        messageId: response.data?.id,
      },
    });
  }

  /**
   * The onboarding nudge — product & marketing (type 3).
   *
   * From the brand ("MastersFit"), with Reply-To pointed at Rich's real inbox:
   * the email closes with a note from Rich inviting a reply, and that reply is
   * the only thing the email is actually trying to buy.
   *
   * The unsubscribe link is built here rather than passed in, so no caller
   * can construct this email without one.
   */
  async sendOnboardingNudgeEmail(params: {
    to: string;
    name: string;
    userId: number;
    postalAddress: string;
  }): Promise<void> {
    const { to, name, userId, postalAddress } = params;

    const unsubscribeUrl = `${publicApiUrl()}/api/email-preferences/unsubscribe?token=${encodeURIComponent(
      signUnsubscribeToken(userId),
    )}`;

    const { html, text } = onboardingNudgeTemplate({
      name,
      continueUrl: onboardingContinueUrl(),
      unsubscribeUrl,
      postalAddress,
    });

    const response = await resend.emails.send({
      from: `MastersFit <${FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: ONBOARDING_NUDGE_SUBJECT,
      html,
      text,
      replyTo: REPLY_TO_EMAIL,
      // One-click unsubscribe. Gmail and Yahoo require this header on bulk
      // mail; without it they are entitled to treat the send as spam no matter
      // how good the footer link is.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Onboarding nudge email sent", {
      operation: "sendOnboardingNudgeEmail",
      metadata: { userId, messageId: response.data?.id },
    });
  }

  /**
   * "Your first session is ready" — sent to someone whose plan is built and
   * untouched.
   *
   * COMMERCIAL, exactly like the onboarding nudge: List-Unsubscribe headers, a
   * footer unsubscribe, and a postal address the caller is required to supply.
   * The caller also consults `email_opted_out_at` before ever reaching here.
   */
  async sendActivationNudgeEmail(params: {
    to: string;
    name: string;
    userId: number;
    planName: string;
    firstSessionName: string | null;
    postalAddress: string;
  }): Promise<void> {
    const { to, name, userId, planName, firstSessionName, postalAddress } =
      params;

    const unsubscribeUrl = `${publicApiUrl()}/api/email-preferences/unsubscribe?token=${encodeURIComponent(
      signUnsubscribeToken(userId),
    )}`;

    const { html, text } = activationNudgeTemplate({
      name,
      planName,
      firstSessionName,
      startUrl: activationStartUrl(),
      unsubscribeUrl,
      postalAddress,
    });

    const response = await resend.emails.send({
      from: `MastersFit <${FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: ACTIVATION_NUDGE_SUBJECT,
      html,
      text,
      replyTo: REPLY_TO_EMAIL,
      // One-click unsubscribe. Gmail and Yahoo require this header on bulk
      // mail; without it they are entitled to treat the send as spam no matter
      // how good the footer link is.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Activation nudge email sent", {
      operation: "sendActivationNudgeEmail",
      metadata: { userId, messageId: response.data?.id },
    });
  }

  /**
   * "A few features you may have missed" — the feature tour, to people who
   * have actually trained with the app.
   *
   * COMMERCIAL, exactly like the two nudges: List-Unsubscribe headers, a footer
   * unsubscribe, and a postal address the caller is required to supply. The
   * caller also consults `email_opted_out_at` before ever reaching here.
   *
   * Takes no per-user content beyond the name. Unlike the activation nudge,
   * which has to name the specific session waiting for you, this email is the
   * same for everyone — the personalisation is the greeting and nothing else,
   * so there is no plan lookup to get wrong.
   */
  async sendFeatureTourEmail(params: {
    to: string;
    name: string;
    userId: number;
    postalAddress: string;
  }): Promise<void> {
    const { to, name, userId, postalAddress } = params;

    const unsubscribeUrl = `${publicApiUrl()}/api/email-preferences/unsubscribe?token=${encodeURIComponent(
      signUnsubscribeToken(userId),
    )}`;

    const { html, text } = featureTourTemplate({
      name,
      unsubscribeUrl,
      postalAddress,
    });

    const response = await resend.emails.send({
      from: `${NUDGE_FROM_NAME} <${NUDGE_FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: FEATURE_TOUR_SUBJECT,
      html,
      text,
      replyTo: NUDGE_REPLY_TO,
      // One-click unsubscribe. Gmail and Yahoo require this header on bulk
      // mail; without it they are entitled to treat the send as spam no matter
      // how good the footer link is.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Feature tour email sent", {
      operation: "sendFeatureTourEmail",
      metadata: { userId, messageId: response.data?.id },
    });
  }

  /**
   * "Still want to give MastersFit a try?" — to someone who finished setup, got
   * a plan, never started it, and whose plan has since expired.
   *
   * COMMERCIAL, like the nudges and the feature tour: List-Unsubscribe headers,
   * a footer unsubscribe, and a postal address the caller must supply. The
   * caller also consults `email_opted_out_at` before reaching here.
   *
   * Takes daysSinceSignup so the template can pick a timeframe that is true for
   * this recipient — the cohort spans 8 days to 289, and one wrong "a few weeks
   * back" is what makes a personal note read as a mailshot. Takes isComped so
   * only a comped reader is told their complimentary access is still active.
   */
  async sendComebackEmail(params: {
    to: string;
    name: string;
    userId: number;
    daysSinceSignup: number;
    isComped: boolean;
    postalAddress: string;
  }): Promise<void> {
    const { to, name, userId, daysSinceSignup, isComped, postalAddress } =
      params;

    const unsubscribeUrl = `${publicApiUrl()}/api/email-preferences/unsubscribe?token=${encodeURIComponent(
      signUnsubscribeToken(userId),
    )}`;

    const { html, text } = comebackTemplate({
      name,
      daysSinceSignup,
      isComped,
      unsubscribeUrl,
      postalAddress,
    });

    const response = await resend.emails.send({
      from: `${NUDGE_FROM_NAME} <${NUDGE_FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: COMEBACK_SUBJECT,
      html,
      text,
      replyTo: NUDGE_REPLY_TO,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Comeback email sent", {
      operation: "sendComebackEmail",
      metadata: { userId, messageId: response.data?.id },
    });
  }

  /**
   * "I've comped your account" — sent when someone is granted COMPLIMENTARY
   * access.
   *
   * TRANSACTIONAL, unlike the onboarding nudge: it reports a change to the
   * recipient's own account, so it carries NO List-Unsubscribe headers and no
   * postal address, and the caller does not consult `email_opted_out_at`.
   * Opting out of setup reminders shouldn't stop us telling you your access
   * changed.
   *
   * Sends as a person for the same reason the nudge does — it's signed "Rich"
   * and it invites a reply.
   *
   * THROWS on failure. The caller (an ops script) has already granted the
   * access, which is the part that matters, and must report the email failure
   * without pretending the comp failed.
   */
  async sendCompGrantedEmail(params: {
    to: string;
    name: string;
  }): Promise<void> {
    const { to, name } = params;

    const { html, text } = compGrantedTemplate({ name });

    const response = await resend.emails.send({
      from: `${NUDGE_FROM_NAME} <${NUDGE_FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: COMP_GRANTED_SUBJECT,
      html,
      text,
      replyTo: NUDGE_REPLY_TO,
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Comp granted email sent", {
      operation: "sendCompGrantedEmail",
      metadata: { recipient: to, messageId: response.data?.id },
    });
  }

  /**
   * "Welcome to MastersFit+" — to a customer who just started a paid
   * subscription. Type 2 (welcome / relationship): From the BRAND, signed by
   * Rich as founder, with Reply-To pointed at Rich's real inbox because the
   * email invites a reply. Owner Bcc like every lifecycle email.
   *
   * TRANSACTIONAL (it confirms a change they just made to their own account),
   * so no List-Unsubscribe headers and no `email_opted_out_at` check.
   *
   * Returns the Resend message id. THROWS on failure; the webhook dispatcher
   * logs it and swallows it so RevenueCat is never affected.
   */
  async sendSubscriberWelcomeEmail(
    params: SubscriberWelcomeTemplateProps & { to: string; subject: string },
  ): Promise<string | undefined> {
    const { to, subject, ...templateProps } = params;

    const { html, text } = subscriberWelcomeTemplate(templateProps);

    const response = await resend.emails.send({
      from: `MastersFit <${FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject,
      html,
      text,
      replyTo: NUDGE_REPLY_TO,
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Subscriber welcome email sent", {
      operation: "sendSubscriberWelcomeEmail",
      metadata: { recipient: to, messageId: response.data?.id },
    });

    return response.data?.id;
  }

  /**
   * Fan out an app-feedback submission to a triage inbox. Bugs go to bug@
   * (sender "MastersFit Bug" so they stand out in the inbox); everything else
   * goes to feedback@. Reply-To is the user's own address — the one thing that
   * makes the promised reply a single tap.
   *
   * Throws on send failure so the caller (which has already committed the row
   * and responded 201) can leave email_sent_at null and retry/alert.
   */
  async sendFeedbackEmail(params: FeedbackEmailParams): Promise<void> {
    const { feedbackId, category, message, userName, userEmail, diagnostics } =
      params;

    const isBug = category === "bug";
    const to = isBug ? [BUG_INBOX] : [FEEDBACK_INBOX];
    const senderName = isBug ? "MastersFit Bug" : "MastersFit Feedback";

    // Category first so Gmail filters match on it; the gist rides the preview.
    const gist = message.replace(/\s+/g, " ").trim().slice(0, 60);
    const subject = `[MastersFit] ${category} — ${gist}`;

    const lines: string[] = [
      message,
      "",
      "—",
      `From: ${userName || "Unknown"}${userEmail ? ` <${userEmail}>` : ""}`,
      `Category: ${category}`,
    ];
    if (diagnostics && Object.keys(diagnostics).length > 0) {
      lines.push("", "Diagnostics:");
      for (const [key, value] of Object.entries(diagnostics)) {
        lines.push(`  ${key}: ${String(value)}`);
      }
    }
    lines.push("", `Feedback record: #${feedbackId} (status: new)`);

    const response = await resend.emails.send({
      from: `${senderName} <${FROM_EMAIL}>`,
      to,
      // The single reason the bug confirmation can honestly say "we'll email
      // you": a reply from the inbox goes straight to the user.
      replyTo: userEmail || REPLY_TO_EMAIL,
      subject,
      text: lines.join("\n"),
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Feedback email sent", {
      operation: "sendFeedbackEmail",
      metadata: {
        feedbackId,
        category,
        recipients: to,
        messageId: response.data?.id,
      },
    });
  }

  /**
   * Internal alert: someone finished onboarding. Goes to the owner, never to
   * the user. Reply-To is the new member's address so a welcome note is one tap.
   *
   * Throws on send failure so the caller can release its claim and let the ops
   * sweep retry — a silently dropped alert looks exactly like nobody signing up.
   */
  async sendNewUserNotificationEmail(
    params: NewUserNotificationTemplateProps,
  ): Promise<void> {
    const to = signupNotifyRecipients();
    if (to.length === 0) {
      throw new Error("No signup notification recipients configured");
    }

    const { html, text } = newUserNotificationTemplate(params);

    const response = await resend.emails.send({
      from: `MastersFit Signups <${FROM_EMAIL}>`,
      to,
      // The new member's own address — replying writes straight to them.
      replyTo: params.email || REPLY_TO_EMAIL,
      subject: `[MastersFit] New user — ${params.name}`,
      html,
      text,
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("New user notification email sent", {
      operation: "sendNewUserNotificationEmail",
      metadata: {
        userId: params.userId,
        recipients: to,
        messageId: response.data?.id,
      },
    });
  }

  /**
   * Internal digest: people who signed up and never finished onboarding. The
   * job only calls this when at least one name is new to the list, so there is
   * no empty-state variant to render.
   *
   * Throws on send failure so the caller leaves everyone unmarked and the next
   * run treats them as new again.
   */
  async sendStalledSignupDigestEmail(
    params: StalledSignupDigestTemplateProps,
  ): Promise<void> {
    const to = signupNotifyRecipients();
    if (to.length === 0) {
      throw new Error("No signup notification recipients configured");
    }

    const { html, text } = stalledSignupDigestTemplate(params);

    const suffix =
      params.newCount === params.totalCount
        ? ""
        : ` (${params.totalCount} open)`;
    const subject = `[MastersFit] ${params.newCount} new stalled signup${
      params.newCount === 1 ? "" : "s"
    }${suffix}`;

    const response = await resend.emails.send({
      from: `MastersFit Signups <${FROM_EMAIL}>`,
      to,
      replyTo: REPLY_TO_EMAIL,
      subject,
      html,
      text,
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Stalled signup digest email sent", {
      operation: "sendStalledSignupDigestEmail",
      metadata: {
        newCount: params.newCount,
        totalCount: params.totalCount,
        recipients: to,
        messageId: response.data?.id,
      },
    });
  }

  /**
   * Internal alert: a customer started a subscription (or a free trial) or
   * cancelled one. Same recipients as the signup alerts — one owner inbox for
   * every internal notification. Reply-To is the customer so a thank-you or a
   * "what made you cancel?" note is one tap.
   *
   * Throws on send failure; the dispatcher logs it and swallows it so the
   * RevenueCat webhook is never affected.
   */
  async sendSubscriptionAlertEmail(
    params: SubscriptionAlertTemplateProps & { subject: string },
  ): Promise<void> {
    const to = signupNotifyRecipients();
    if (to.length === 0) {
      throw new Error("No signup notification recipients configured");
    }

    const { html, text } = subscriptionAlertTemplate(params);

    const response = await resend.emails.send({
      from: `MastersFit Subscriptions <${FROM_EMAIL}>`,
      to,
      replyTo: params.email || REPLY_TO_EMAIL,
      subject: params.subject,
      html,
      text,
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    logger.info("Subscription alert email sent", {
      operation: "sendSubscriptionAlertEmail",
      metadata: {
        kind: params.kind,
        userId: params.userId,
        recipients: to,
        messageId: response.data?.id,
      },
    });
  }
}

export const emailService = new EmailService();

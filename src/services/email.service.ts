import { Resend } from "resend";
import { otpEmailTemplate } from "@/templates/otp-email";
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
  compGrantedTemplate,
  COMP_GRANTED_SUBJECT,
} from "@/templates/comp-granted-email";
import { signupNotifyRecipients } from "@/constants/signup-notifications";
import {
  onboardingContinueUrl,
  publicApiUrl,
} from "@/constants/onboarding-nudge";
import { signUnsubscribeToken } from "@/utils/email-token";
import { logger } from "@/utils/logger";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || "system@alif.care";
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || "noreply@alif.care";

// The onboarding nudge is signed by a person, so it sends as one. The address
// must still live on the Resend-verified domain (updates.mastersfit.ai) or the
// send is rejected — hence rtp@ THERE, with Reply-To pointing at the real
// mailbox that a human actually reads.
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
        subject: `Your MastersFit code is ${otp}.`,
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
   * The onboarding nudge — the one email in this service that goes to a
   * customer for a reason they didn't ask for.
   *
   * Two departures from every other send here, both intentional:
   *
   *   From is a PERSON, not the brand. It still has to sit on the Resend
   *   verified domain (updates.mastersfit.ai), so this is rtp@ on that domain
   *   with Reply-To pointed at the real rtp@mastersfit.ai inbox. Sending a
   *   "just hit reply" email from noreply@ would undercut the only thing the
   *   email is actually trying to buy.
   *
   *   The unsubscribe link is built here rather than passed in, so no caller
   *   can construct this email without one.
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
      from: `${NUDGE_FROM_NAME} <${NUDGE_FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: ONBOARDING_NUDGE_SUBJECT,
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
      from: `${NUDGE_FROM_NAME} <${NUDGE_FROM_EMAIL}>`,
      to,
      bcc: lifecycleBcc(to),
      subject: ACTIVATION_NUDGE_SUBJECT,
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

    logger.info("Activation nudge email sent", {
      operation: "sendActivationNudgeEmail",
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
}

export const emailService = new EmailService();

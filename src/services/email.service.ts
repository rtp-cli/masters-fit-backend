import { Resend } from "resend";
import { otpEmailTemplate } from "@/templates/otp-email";
import { logger } from "@/utils/logger";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || "system@alif.care";
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || "noreply@alif.care";

// Triage inboxes — Google Workspace Groups forwarding to a real person.
// On To (never Bcc): Bcc strips the alias the Gmail filters key on.
const FEEDBACK_INBOX = "feedback@mastersfit.ai";
const BUG_INBOX = "bug@mastersfit.ai";

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
}

export const emailService = new EmailService();

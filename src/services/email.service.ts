import { Resend } from "resend";
import { otpEmailTemplate } from "@/templates/otp-email";
import { logger } from "@/utils/logger";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || "system@alif.care";
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || "noreply@alif.care";

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
}

export const emailService = new EmailService();

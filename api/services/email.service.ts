import { Resend } from "resend";
import { otpEmailTemplate } from "@/templates/otp-email";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || "system@alif.care";
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || "noreply@alif.care";

export class EmailService {
  async sendOtpEmail(to: string, otp: string, name: string) {
    try {
      console.log(`[EmailService] Preparing to send OTP email to: ${to}`);
      const { html, text } = otpEmailTemplate({ otp, name });

      const response = await resend.emails.send({
        from: `MastersFit <${FROM_EMAIL}>`,
        to,
        subject: "Your MastersFit Verification Code",
        html,
        text,
        replyTo: REPLY_TO_EMAIL,
      });

      console.log(`[EmailService] Email sent successfully to: ${to}`, response);

      if (response.error) {
        console.error(
          "[EmailService] Resend responded with an error:",
          response.error
        );
        throw new Error(`Resend error: ${response.error.message}`);
      }
    } catch (error) {
      console.error(
        "[EmailService] An exception occurred while sending email:",
        error
      );
      throw new Error("Failed to send OTP email");
    }
  }
}

export const emailService = new EmailService();

import {
  accountLayout,
  firstNameOf,
  type RenderedEmail,
} from "@/templates/email-layouts";

interface OtpEmailTemplateProps {
  otp: string;
  /** User's display name; only the first name is shown, escaped. */
  name: string;
}

/** Subject. No trailing period: it sits in the inbox list next to the code. */
export const otpEmailSubject = (otp: string): string =>
  `Your MastersFit code is ${otp}`;

/**
 * The sign-in / verification code. Type 4, account & billing: logo header,
 * the code, unsigned, transactional footer. No links in the body.
 */
export const otpEmailTemplate = ({
  otp,
  name,
}: OtpEmailTemplateProps): RenderedEmail =>
  accountLayout({
    title: "Verify your email",
    preheader: `Your MastersFit verification code is ${otp}. It expires in 10 minutes.`,
    heading: "Verify your email",
    firstName: firstNameOf(name),
    blocks: [
      { kind: "paragraph", text: "Enter this code to verify your email." },
      { kind: "code", label: "Your verification code", value: otp },
      {
        kind: "fineprint",
        text: "This code expires in 10 minutes. Don’t share it with anyone — MastersFit will never ask you for it.",
      },
    ],
    footerNote: "If you didn’t request this, you can safely ignore this email.",
  });

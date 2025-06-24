// IMPORTANT: For the logo to be visible in emails, it must be hosted on a public URL.
// The URL below is a placeholder. For production, you should host your logo on a CDN or public server.
const LOGO_URL = process.env.LOGO_URL || "https://i.imgur.com/2nL4s3b.png";
const brandName = "MastersFit";
const backgroundColor = "#f0f2f5";
const containerBackgroundColor = "#9BB875";
const textColor = "#ffffff";
const lightTextColor = "#ffffff";
const accentColor = "#ffffff";

interface OtpEmailTemplateProps {
  otp: string;
  name: string;
}

export const otpEmailTemplate = ({ otp, name }: OtpEmailTemplateProps) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700&display=swap');
        body { font-family: 'IBM Plex Sans', Arial, sans-serif; background-color: ${backgroundColor}; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background-color: ${containerBackgroundColor}; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { max-width: 60px; }
        .brand-name { font-size: 28px; font-weight: normal; color: ${textColor}; }
        .content { color: ${textColor}; font-size: 16px; line-height: 1.6; text-align: left; }
        .otp-code { text-align: center; font-size: 24px; font-weight: bold; color: ${accentColor}; margin: 20px 0; letter-spacing: 4px; }
        .footer { font-size: 12px; color: ${lightTextColor}; margin-top: 30px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;">
            <tr>
              <td style="vertical-align: middle;">
                <img src="${LOGO_URL}" alt="${brandName} Logo" class="logo" />
              </td>
              <td style="vertical-align: middle; padding-left: 5px; font-weight: 400;">
                <span class="brand-name">${brandName}</span>
              </td>
            </tr>
          </table>
        </div>
        <div class="content">
          <p>Hi ${name}!</p>
          <p>To join the ${brandName} squad, please verify your email with this OTP:</p>
          <div class="otp-code">${otp}</div>
          <p>This code will expire in 10 minutes. Do not share this code with anyone.</p>
          <p>Thank you for using ${brandName}!</p>
          <br>
          <p>
            Sincerely,<br>
            Team ${brandName}
          </p>
        </div>
        <div class="footer">
          <p>If you did not request this email, you can safely ignore it.</p>
          <p>Copyright © ${new Date().getFullYear()} ${brandName}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
    Hi ${name},
    To join the ${brandName} squad, please verify your email with this OTP: ${otp}
    This code will expire in 10 minutes. Do not share this code with anyone.
    Thank you for using ${brandName}!

    Sincerely,
    Team ${brandName}

    If you did not request this email, you can safely ignore it.
    Copyright © ${new Date().getFullYear()} ${brandName}. All rights reserved.
  `;

  return { html, text };
};

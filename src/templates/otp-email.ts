const LOGO_URL = process.env.LOGO_URL || "https://mastersfit.ai/email/logo-dark.png";

interface OtpEmailTemplateProps {
  otp: string;
  name: string;
}

export const otpEmailTemplate = ({ otp, name }: OtpEmailTemplateProps) => {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>Verify your email &ndash; MastersFit</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a { text-decoration: none; }
  .otp-code { font-variant-numeric: tabular-nums; }
  @media (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 28px !important; padding-right: 28px !important; }
    .otp-code { font-size: 38px !important; letter-spacing: 0.22em !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#F4F4F4;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F4F4; opacity:0;">
    Your MastersFit verification code is ${otp}. It expires in 10 minutes.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F4F4;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background-color:#FFFFFF; border:1px solid #E0E0E0; border-radius:24px; overflow:hidden;">

          <!-- Logo lockup -->
          <tr>
            <td align="center" class="px" style="padding:44px 56px 0 56px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px; vertical-align:middle;">
                    <img src="${LOGO_URL}" width="34" height="31" alt="MastersFit" style="display:block; width:34px; height:auto;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:22px; font-weight:500; letter-spacing:-0.01em; color:#0A0A0A;">MastersFit</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td class="px" style="padding:36px 56px 0 56px;">
              <h1 style="margin:0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; color:#0A0A0A;">Verify your email</h1>
            </td>
          </tr>

          <!-- Body copy -->
          <tr>
            <td class="px" style="padding:18px 56px 0 56px;">
              <p style="margin:0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#3C3C3C;">
                ${greeting}
              </p>
              <p style="margin:14px 0 0 0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#3C3C3C;">
                Enter this code to verify your email.
              </p>
            </td>
          </tr>

          <!-- OTP code block -->
          <tr>
            <td class="px" style="padding:28px 56px 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9F9; border:1px solid #E0E0E0; border-radius:16px;">
                <tr>
                  <td align="center" style="padding:26px 20px;">
                    <div style="font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#757575;">
                      Your verification code
                    </div>
                    <div class="otp-code" style="margin-top:12px; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:46px; font-weight:700; letter-spacing:0.28em; color:#0A0A0A; line-height:1; padding-left:0.28em; font-variant-numeric:tabular-nums;">
                      ${otp}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Expiry note -->
          <tr>
            <td class="px" style="padding:22px 56px 0 56px;">
              <p style="margin:0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#757575;">
                This code expires in 10 minutes. Don&rsquo;t share it with anyone &mdash; MastersFit will never ask you for it.
              </p>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td class="px" style="padding:24px 56px 44px 56px;">
              <p style="margin:0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.6; color:#3C3C3C;">
                Train well,<br />The MastersFit team
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td class="px" style="padding:0 56px;">
              <div style="height:1px; background-color:#F4F4F4; line-height:1px; font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="px" align="center" style="padding:28px 56px 40px 56px;">
              <p style="margin:0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#9E9E9E;">
                If you didn&rsquo;t request this, you can safely ignore this email.
              </p>
              <p style="margin:14px 0 0 0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.7; color:#9E9E9E;">
                <a href="https://mastersfit.ai/privacy" style="color:#757575; text-decoration:underline;">Privacy</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://mastersfit.ai/terms" style="color:#757575; text-decoration:underline;">Terms</a><br />
                &copy; ${year} MastersFit. All rights reserved.
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-card brand line -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px;">
          <tr>
            <td align="center" style="padding:20px 16px 0 16px;">
              <p style="margin:0; font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; letter-spacing:0.04em; color:#C0C0C0;">
                Fitness Mastered. AI-Powered.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const text = `Your MastersFit verification code is ${otp}. It expires in 10 minutes.

${greeting}

Enter this code to verify your email: ${otp}

This code expires in 10 minutes. Don't share it with anyone — MastersFit will never ask you for it.

Train well,
The MastersFit team

If you didn't request this, you can safely ignore this email.
Privacy: https://mastersfit.ai/privacy | Terms: https://mastersfit.ai/terms
© ${year} MastersFit. All rights reserved.`;

  return { html, text };
};

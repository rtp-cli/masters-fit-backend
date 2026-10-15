/**
 * Brand constants and escaping shared by the internal ops email templates.
 *
 * Extracted when the two signup-notification templates would otherwise have
 * carried private copies: an escaping fix or a logo/font change applied to one
 * and missed in the other is exactly the drift this file exists to prevent.
 * The older customer templates (otp, renewal) still carry their own copies —
 * migrating them is safe but deliberately out of scope here.
 *
 * Customer-facing emails are moving onto the shared per-type layouts in
 * email-layouts.ts, which build on these constants.
 */

// The FINAL URL, deliberately: the bare domain 308-redirects to www., and
// some mail clients' image proxies (Apple Mail MPP among them) refuse to
// follow it — the logo silently vanished from every email in those clients.
export const LOGO_URL =
  process.env.LOGO_URL || "https://www.mastersfit.ai/email/logo-dark.png";

export const FONT =
  "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const MONO =
  "'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/**
 * MastersFit's business mailing address, for the footer of every product &
 * marketing email (CAN-SPAM requires a valid physical postal address on
 * commercial mail).
 *
 * Source: the public website, which prints it in three places — the privacy
 * policy and terms "Contact Us" sections and the site footer
 * (website/privacy.html, terms.html, index.html). If the business moves,
 * change it there AND here.
 *
 * NOTE: the older nudges (onboarding, activation, comeback, feature tour) do
 * NOT read this — they take COMPANY_POSTAL_ADDRESS from the environment. They
 * move onto this constant when they migrate to the shared layouts.
 */
export const MASTERSFIT_POSTAL_ADDRESS =
  "MastersFit LLC\n1606 NW 106th Ter\nKansas City, MO 64155-1656";

/**
 * Escape a value for interpolation into email HTML. Names and email addresses
 * rendered by the ops templates are user-supplied — treat them all as hostile.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

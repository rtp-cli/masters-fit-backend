/**
 * Brand constants and escaping shared by the internal ops email templates.
 *
 * Extracted when the two signup-notification templates would otherwise have
 * carried private copies: an escaping fix or a logo/font change applied to one
 * and missed in the other is exactly the drift this file exists to prevent.
 * The older customer templates (otp, renewal) still carry their own copies —
 * migrating them is safe but deliberately out of scope here.
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
 * Escape a value for interpolation into email HTML. Names and email addresses
 * rendered by the ops templates are user-supplied — treat them all as hostile.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

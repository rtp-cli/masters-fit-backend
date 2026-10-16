/**
 * Brand constants and escaping shared by the internal ops email templates.
 *
 * Extracted when the two signup-notification templates would otherwise have
 * carried private copies: an escaping fix or a logo/font change applied to one
 * and missed in the other is exactly the drift this file exists to prevent.
 *
 * Customer-facing emails are built on the shared per-type layouts in
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
 * The square logo tile at the top of every BRANDED customer email (types 2-4).
 *
 * One opaque white 104x104 PNG (shown at 52x52, no border: invisible on the
 * white email in light mode) holding the dark outline mark,
 * so the mark can never sit on a dark-mode background and vanish. Hosted on
 * the website (repo mastersfit-website-next, assets/email/), at its FINAL URL —
 * no redirects, for the same image-proxy reason as LOGO_URL above.
 *
 * CACHING: the website serves /assets/* with `Cache-Control: immutable` for a
 * year. If the tile ever changes, publish it under a NEW file name (e.g.
 * logo-tile-v2@2x.png) and point this at it; overwriting the old file leaves
 * stale copies in mail-client image caches for up to a year.
 */
export const LOGO_TILE_URL =
  process.env.EMAIL_LOGO_TILE_URL ||
  "https://www.mastersfit.ai/assets/email/logo-tile-v2@2x.png";

/** The legal entity named in every customer email footer. */
export const COMPANY_LEGAL_NAME = "MastersFit LLC";

/**
 * The STREET part of the business address for the commercial-email footer
 * (CAN-SPAM requires a valid physical postal address on commercial mail).
 *
 * The value comes ONLY from the COMPANY_POSTAL_ADDRESS env var, read by the
 * callers (constants/*-nudge.ts `companyPostalAddress()`); nothing here
 * hard-codes an address. The footer prints "MastersFit LLC" itself, so the env
 * var should hold the street address alone. A value that already starts with
 * the company name is tolerated — the name is stripped so it isn't printed
 * twice.
 */
export function streetAddress(raw: string): string {
  return raw
    .trim()
    .replace(/^mastersfit,?\s+llc\s*[,\n\r]*\s*/i, "")
    .trim();
}

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

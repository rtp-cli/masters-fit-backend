/**
 * Phone numbers for SMS sign-in. US + Canada (+1, the North American Numbering
 * Plan) only, by design: SMS-pumping fraud targets international premium
 * ranges, and allowing only +1 removes most of that exposure before a single
 * text is paid for. Twilio's Geo permissions should be set to US + Canada as a
 * second, independent layer.
 *
 * No libphonenumber dependency: NANP is one fixed format, so the rules fit in
 * a few lines.
 */

/**
 * Normalize user input to E.164 ("+13125550123"), or null if it is not a valid
 * NANP number. Accepts the shapes people actually type: "(312) 555-0123",
 * "312.555.0123", "1 312 555 0123", "+1 312-555-0123".
 *
 * NANP rules enforced: the area code and the exchange both start 2-9, and
 * neither is an N11 service code (211, 311, 411, 911, …), which are never
 * assigned to subscribers.
 */
export function normalizeUsPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Anything that says it is a non-+1 international number is rejected, not
  // silently reinterpreted as a US one.
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;

  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (!/^[2-9]/.test(area) || !/^[2-9]/.test(exchange)) return null;
  if (/^[2-9]11$/.test(area) || /^[2-9]11$/.test(exchange)) return null;

  return `+1${digits}`;
}

/**
 * Log-safe form: "+1•••••••0123". A phone number is personal data, so logs
 * carry only enough to tell two numbers apart.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return `${phone.slice(0, 2)}•••••••${phone.slice(-4)}`;
}

/** Display form for E.164 +1 numbers: "(312) 555-0123". */
export function formatUsPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/^\+1/, "");
  if (!/^\d{10}$/.test(d)) return phone;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

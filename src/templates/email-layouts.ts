import {
  COMPANY_LEGAL_NAME,
  LOGO_TILE_URL,
  escapeHtml,
  streetAddress,
} from "@/templates/email-shared";

/**
 * Shared layouts for every CUSTOMER-facing email, one per email TYPE.
 *
 *   1. personalLayout      — a plain note from Rich. No logo, no buttons, a
 *                            small text signature. Optional unsubscribe +
 *                            address footer for the personal notes that are
 *                            commercial mail (comeback, feature tour).
 *   2. welcomeLayout       — relationship mail from MastersFit: logo header,
 *                            outlined button, signed "— Rich / Founder,
 *                            MastersFit", transactional footer.
 *   3. nudgeLayout         — product & marketing: one short message, one
 *      announcementLayout    button / a headline + feature sections. Both
 *                            REQUIRE an unsubscribe URL and a postal address
 *                            (CAN-SPAM).
 *   4. accountLayout       — account & billing (codes, renewals). Logo header,
 *                            unsigned, transactional footer.
 *
 * (The internal owner alerts are deliberately not here.)
 *
 * A template supplies CONTENT ONLY — a list of blocks plus the type's fields.
 * The layout owns everything that should look the same across emails of a
 * type: the logo header, the white page, body type size and spacing, the
 * button, the signature and the footer. Every layout returns `{ html, text }`.
 *
 * Every string a template passes in is treated as PLAIN TEXT and escaped
 * here; there is no way to inject raw HTML except the explicit `strong` lead
 * on a paragraph/bullet and the inline `link` on a paragraph, both escaped
 * too. Links and image sources must be http(s) (or mailto: for links) —
 * anything else throws at render time, so a stray `javascript:` or a custom
 * app scheme (which Gmail blocks) can't ship.
 *
 * The HTML is the conservative subset proven in Gmail and Apple Mail: tables
 * for layout, every style inline, a hidden preheader padded so body text can't
 * leak into the inbox preview, `format-detection` + the `x-apple-data-detectors`
 * reset so the footer address isn't turned into a blue Maps link, and a
 * bulletproof table-cell button.
 */

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

/**
 * A body paragraph. `lead` renders bold in front of the text ("Your next
 * step:"). `link` turns the first occurrence of `link.text` inside `text` into
 * an inline link (bold when `bold`); the plain-text half prints the URL after it.
 */
export interface ParagraphBlock {
  kind: "paragraph";
  text: string;
  lead?: string;
  link?: { text: string; href: string; bold?: boolean };
}

/** A bulleted list. Each item may have a bold `lead`. */
export interface BulletsBlock {
  kind: "bullets";
  /** Optional line introducing the list ("Your subscription gives you…"). */
  intro?: string;
  items: { lead?: string; text: string }[];
}

/** The one call-to-action button. Placed exactly where it appears in `blocks`. */
export interface ButtonBlock {
  kind: "button";
  label: string;
  href: string;
}

/** A boxed code (verification codes). Account emails only, in practice. */
export interface CodeBlock {
  kind: "code";
  label: string;
  value: string;
}

/** A grey box with a small label, one big value and an optional line under it. */
export interface DetailBlock {
  kind: "detail";
  label: string;
  value: string;
  sub?: string;
}

/** Small muted paragraph (expiry notes). */
export interface FinePrintBlock {
  kind: "fineprint";
  text: string;
}

/**
 * One tip in a personal note: a bold title, the tap path on its own muted
 * line directly under it, then the explanation.
 */
export interface TipBlock {
  kind: "tip";
  title: string;
  path: string;
  body: string;
}

export type EmailBlock =
  | ParagraphBlock
  | BulletsBlock
  | ButtonBlock
  | CodeBlock
  | DetailBlock
  | FinePrintBlock
  | TipBlock;

export interface RenderedEmail {
  html: string;
  text: string;
}

interface CommonLayoutProps {
  /** The <title>; use the subject line. */
  title: string;
  /** The grey preview line after the subject in most inboxes. */
  preheader: string;
  /**
   * First name for the greeting ("Hi Jordan,"). Empty/blank renders
   * "Hi there,". Pass null to omit the greeting entirely. Escaped here — pass
   * the raw value.
   */
  firstName: string | null;
  blocks: EmailBlock[];
}

/** A short note from Rich inside a MastersFit-signed email (type 3). */
export interface RichNote {
  text: string;
}

/** The commercial-mail footer inputs. Both required, both checked. */
export interface MarketingFooter {
  /** Fully-built, signed unsubscribe link. */
  unsubscribeUrl: string;
  /** The COMPANY_POSTAL_ADDRESS env value (street address). */
  postalAddress: string;
}

// ---------------------------------------------------------------------------
// Design tokens (one place)
// ---------------------------------------------------------------------------

/**
 * System fonts, deliberately — no web font. Gmail strips <link> fonts, so a
 * Manrope-first stack renders differently per client; the system stack looks
 * the same everywhere.
 */
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const COLOR = {
  page: "#FFFFFF",
  text: "#1A1A1A",
  ink: "#0A0A0A",
  muted: "#5A5A5A",
  footer: "#767676",
  rule: "#E5E5E5",
  /** Body links: near-black and underlined. No brand green anywhere. */
  link: "#0A0A0A",
  box: "#F6F6F6",
};

const BODY = `font-family:${FONT}; font-size:17px; line-height:1.6; color:${COLOR.text};`;
const P = `margin:0 0 16px 0; ${BODY}`;
const SMALL = `font-family:${FONT}; font-size:13px; line-height:1.6; color:${COLOR.footer};`;
const LINK = `color:${COLOR.link}; text-decoration:underline;`;
const FOOTER_LINK = `color:${COLOR.footer}; text-decoration:underline;`;
const LABEL = `font-family:${FONT}; font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${COLOR.muted};`;

/** Content column width. 600 is the safe maximum for every client. */
const WIDTH = 600;

const SITE_URL = "https://www.mastersfit.ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
const SAFE_IMAGE = /^https?:\/\//i;

function safeHref(url: string): string {
  if (!SAFE_LINK.test(url.trim())) {
    throw new Error(
      `Email link must be http(s) or mailto (custom schemes are blocked by Gmail): ${url}`
    );
  }
  return escapeHtml(url.trim());
}

function safeSrc(url: string): string {
  if (!SAFE_IMAGE.test(url.trim())) {
    throw new Error(`Email image must be an http(s) URL: ${url}`);
  }
  return escapeHtml(url.trim());
}

/** Typographic copy → ASCII-ish, for the text/plain half. */
export const toPlain = (s: string): string =>
  s
    .replace(/→/g, "->")
    .replace(/\s*—\s*/g, " - ")
    .replace(/–/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, "-");

/** First word of a display name, or "" when there isn't one. */
export function firstNameOf(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "";
}

function greetingHtml(firstName: string | null, suffix = ","): string {
  if (firstName === null) return "";
  const who = firstName.trim() ? escapeHtml(firstName.trim()) : "there";
  return `<p style="${P}">Hi ${who}${escapeHtml(suffix)}</p>`;
}

function greetingText(firstName: string | null, suffix = ","): string {
  if (firstName === null) return "";
  return `Hi ${firstName.trim() || "there"}${toPlain(suffix).trimEnd()}\n\n`;
}

/**
 * The one button style for every email: outlined, never filled. White fill,
 * 1.5px near-black border, near-black text. 15px text + 14px padding + border
 * is ~49px tall, over the 44px touch minimum. `border-collapse:separate` so
 * the cell's border-radius isn't flattened by the global collapse rule;
 * `nowrap` so a label never breaks onto two lines inside the outline.
 */
function buttonHtml(label: string, href: string): string {
  // No `align` attribute: an aligned table FLOATS in most clients and lets the
  // next paragraph wrap up beside the button.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0; border-collapse:separate;">
  <tr>
    <td align="center" bgcolor="${COLOR.page}" style="background-color:${COLOR.page}; border:1.5px solid ${COLOR.ink}; border-radius:10px;">
      <a href="${safeHref(href)}" target="_blank" style="display:inline-block; padding:14px 24px; font-family:${FONT}; font-size:15px; font-weight:600; line-height:1.2; color:${COLOR.ink}; text-decoration:none; border-radius:10px; white-space:nowrap;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function leadHtml(lead: string | undefined): string {
  return lead ? `<strong style="color:${COLOR.text};">${escapeHtml(lead)}</strong> ` : "";
}

function splitOnLink(block: ParagraphBlock): [string, string, string] | null {
  if (!block.link) return null;
  const i = block.text.indexOf(block.link.text);
  if (i < 0) {
    throw new Error(`Paragraph link text not found in paragraph: ${block.link.text}`);
  }
  return [
    block.text.slice(0, i),
    block.link.text,
    block.text.slice(i + block.link.text.length),
  ];
}

function paragraphInnerHtml(block: ParagraphBlock): string {
  const parts = splitOnLink(block);
  if (!parts || !block.link) return `${leadHtml(block.lead)}${escapeHtml(block.text)}`;
  const [before, linkText, after] = parts;
  const weight = block.link.bold ? " font-weight:700;" : "";
  return `${leadHtml(block.lead)}${escapeHtml(before)}<a href="${safeHref(block.link.href)}" target="_blank" style="${LINK}${weight}">${escapeHtml(linkText)}</a>${escapeHtml(after)}`;
}

function boxTable(inner: string, align: "left" | "center" = "left", padding = "16px 20px"): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0; background-color:${COLOR.box}; border-radius:12px; border-collapse:separate;">
  <tr>
    <td align="${align}" bgcolor="${COLOR.box}" style="padding:${padding}; background-color:${COLOR.box}; border-radius:12px;">
${inner}
    </td>
  </tr>
</table>`;
}

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "paragraph":
      return `<p style="${P}">${paragraphInnerHtml(block)}</p>`;
    case "bullets": {
      const intro = block.intro
        ? `<p style="margin:0 0 8px 0; ${BODY}">${escapeHtml(block.intro)}</p>`
        : "";
      const items = block.items
        .map(
          (item) =>
            `<li style="margin:0 0 8px 0; ${BODY}">${leadHtml(item.lead)}${escapeHtml(item.text)}</li>`
        )
        .join("\n");
      return `${intro}<ul style="margin:0 0 16px 0; padding:0 0 0 22px;">\n${items}\n</ul>`;
    }
    case "button":
      return buttonHtml(block.label, block.href);
    case "code":
      return boxTable(
        `      <div style="${LABEL} letter-spacing:0.12em;">${escapeHtml(block.label)}</div>
      <div style="margin-top:10px; font-family:${FONT}; font-size:38px; font-weight:700; letter-spacing:0.24em; padding-left:0.24em; line-height:1; color:${COLOR.ink}; font-variant-numeric:tabular-nums;">${escapeHtml(block.value)}</div>`,
        "center",
        "24px 16px"
      );
    case "detail":
      return boxTable(
        `      <div style="${LABEL}">${escapeHtml(block.label)}</div>
      <div style="margin-top:6px; font-family:${FONT}; font-size:19px; font-weight:700; line-height:1.3; color:${COLOR.ink};">${escapeHtml(block.value)}</div>${
          block.sub
            ? `\n      <div style="margin-top:4px; font-family:${FONT}; font-size:15px; line-height:1.5; color:${COLOR.muted};">${escapeHtml(block.sub)}</div>`
            : ""
        }`,
        "left",
        "18px 20px"
      );
    case "fineprint":
      return `<p style="margin:0 0 16px 0; font-family:${FONT}; font-size:15px; line-height:1.6; color:${COLOR.muted};">${escapeHtml(block.text)}</p>`;
    case "tip":
      return `<p style="margin:8px 0 4px 0; font-family:${FONT}; font-size:17px; line-height:1.4; font-weight:700; color:${COLOR.text};">${escapeHtml(block.title)}</p>
<p style="margin:0 0 6px 0; font-family:${FONT}; font-size:15px; line-height:1.5; color:${COLOR.muted};">${escapeHtml(block.path)}</p>
<p style="${P}">${escapeHtml(block.body)}</p>`;
  }
}

function blockText(block: EmailBlock): string {
  const lead = (l?: string) => (l ? `${toPlain(l)} ` : "");
  switch (block.kind) {
    case "paragraph": {
      const parts = splitOnLink(block);
      if (!parts || !block.link) return `${lead(block.lead)}${toPlain(block.text)}`;
      const [before, linkText, after] = parts;
      return `${lead(block.lead)}${toPlain(before)}${toPlain(linkText)} (${block.link.href.trim()})${toPlain(after)}`;
    }
    case "bullets": {
      const items = block.items
        .map((i) => `- ${lead(i.lead)}${toPlain(i.text)}`)
        .join("\n");
      return block.intro ? `${toPlain(block.intro)}\n${items}` : items;
    }
    case "button":
      return `${toPlain(block.label)}: ${block.href.trim()}`;
    case "code":
      return `${toPlain(block.label)}: ${block.value}`;
    case "detail":
      return `${toPlain(block.label)}: ${toPlain(block.value)}${block.sub ? ` (${toPlain(block.sub)})` : ""}`;
    case "fineprint":
      return toPlain(block.text);
    case "tip":
      return `${toPlain(block.title)}\n${toPlain(block.path)}\n${toPlain(block.body)}`;
  }
}

/**
 * The branded header for types 2-4: a 52x52 white logo tile (an opaque PNG,
 * so the mark survives dark mode) and the live-text wordmark. With images
 * blocked, the alt text and the wordmark both still read "MastersFit".
 */
function logoHeaderHtml(): string {
  return `<tr>
  <td style="padding:0 0 28px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="52" style="width:52px; vertical-align:middle;">
          <img src="${safeSrc(LOGO_TILE_URL)}" width="52" height="52" alt="MastersFit" style="display:block; width:52px; height:52px; border:0; border-radius:10px; font-family:${FONT}; font-size:13px; color:${COLOR.ink};" />
        </td>
        <td style="padding-left:12px; vertical-align:middle; font-family:${FONT}; font-size:22px; line-height:1.2; font-weight:700; letter-spacing:-0.01em; color:${COLOR.ink};">MastersFit</td>
      </tr>
    </table>
  </td>
</tr>`;
}

function requireAddress(raw: string | undefined | null): string {
  const street = raw ? streetAddress(raw) : "";
  if (!street) {
    throw new Error(
      "Commercial emails require a postal address (COMPANY_POSTAL_ADDRESS)"
    );
  }
  return street;
}

function addressHtml(address: string): string {
  // Escape FIRST, then turn newlines into breaks — the other order would
  // escape the <br> tags.
  return escapeHtml(address).replace(/\r?\n/g, "<br />");
}

/** The legal links shared by the branded footers. */
function legalLinksHtml(): string {
  return `<a href="${SITE_URL}/privacy" style="${FOOTER_LINK}">Privacy</a>&nbsp;&middot;&nbsp;<a href="${SITE_URL}/terms" style="${FOOTER_LINK}">Terms</a>`;
}

const LEGAL_LINKS_TEXT = `Privacy: ${SITE_URL}/privacy | Terms: ${SITE_URL}/terms`;

/**
 * The hidden preheader, followed by ~90 zero-width-non-joiner + nbsp pairs so
 * the inbox preview stops after it instead of pulling in the greeting.
 */
function preheaderHtml(preheader: string): string {
  return `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${COLOR.page}; opacity:0;">${escapeHtml(preheader)}${"&zwnj;&nbsp;".repeat(90)}</div>`;
}

/**
 * The document shell: head, hidden preheader, white page, a centered column
 * at most 600px wide. `rows` are <tr>s inside that column.
 */
function shell(opts: { title: string; preheader: string; rows: string }): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />
<title>${escapeHtml(opts.title)}</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${COLOR.link}; text-decoration:underline; }
  a[x-apple-data-detectors] {
    color: inherit !important; text-decoration: none !important; font-size: inherit !important;
    font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important;
  }
  @media (max-width: 620px) {
    .wrap { padding:28px 20px !important; }
    .feature-img { width:100% !important; height:auto !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${COLOR.page};">
${preheaderHtml(opts.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.page};">
  <tr>
    <td align="center" style="padding:0;">
      <!--[if mso]><table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px; background-color:${COLOR.page};">
        <tr>
          <td class="wrap" align="left" style="padding:40px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${opts.rows}
            </table>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}

const row = (inner: string) => `<tr><td style="padding:0;">\n${inner}\n</td></tr>`;

function bodyRows(firstName: string | null, blocks: EmailBlock[], greetingSuffix?: string): string {
  return [greetingHtml(firstName, greetingSuffix), ...blocks.map(blockHtml)]
    .filter(Boolean)
    .map(row)
    .join("\n");
}

function bodyText(firstName: string | null, blocks: EmailBlock[], greetingSuffix?: string): string {
  return `${greetingText(firstName, greetingSuffix)}${blocks.map(blockText).join("\n\n")}`;
}

function ruleRow(): string {
  return row(`<div style="height:1px; line-height:1px; font-size:1px; background-color:${COLOR.rule}; margin:8px 0 20px 0;">&nbsp;</div>`);
}

function richNoteHtml(note: RichNote): string {
  return boxTable(
    `      <p style="margin:0 0 8px 0; ${LABEL}">A note from Rich</p>
      <p style="margin:0 0 10px 0; ${BODY}">${escapeHtml(note.text)}</p>
      <p style="margin:0; ${BODY}">&mdash; Rich, Founder</p>`,
    "left",
    "18px 20px"
  );
}

function richNoteText(note: RichNote): string {
  return `A note from Rich:\n${toPlain(note.text)}\n- Rich, Founder`;
}

/** §1.4 — the transactional footer row for types 2 and 4. */
function transactionalFooterHtml(): string {
  return `<p style="margin:0; ${SMALL}">${COMPANY_LEGAL_NAME}&nbsp;&middot;&nbsp;${legalLinksHtml()}</p>`;
}

const TRANSACTIONAL_FOOTER_TEXT = `${COMPANY_LEGAL_NAME}\n${LEGAL_LINKS_TEXT}`;

/** §1.3 — type 3 footer: why you got it, unsubscribe, company + address, legal. */
function marketingFooterRows(footer: MarketingFooter): string {
  const street = requireAddress(footer.postalAddress);
  return [
    ruleRow(),
    row(`<p style="margin:0 0 12px 0; ${SMALL}">You're receiving this because you have a MastersFit account. <a href="${safeHref(footer.unsubscribeUrl)}" style="${FOOTER_LINK}">Unsubscribe from these emails</a>.</p>
<p style="margin:0 0 12px 0; ${SMALL}">${COMPANY_LEGAL_NAME}<br />${addressHtml(street)}</p>
<p style="margin:0; ${SMALL}">${legalLinksHtml()}</p>`),
  ].join("\n");
}

function marketingFooterText(footer: MarketingFooter): string {
  return `---
You're receiving this because you have a MastersFit account.
Unsubscribe from these emails: ${footer.unsubscribeUrl.trim()}
${COMPANY_LEGAL_NAME}
${requireAddress(footer.postalAddress)}
${LEGAL_LINKS_TEXT}`;
}

/** §1.3, personal variant: just the unsubscribe link, then company · address. */
function personalFooterRows(footer: MarketingFooter): string {
  const street = requireAddress(footer.postalAddress);
  return [
    ruleRow(),
    row(`<p style="margin:0; ${SMALL}"><a href="${safeHref(footer.unsubscribeUrl)}" style="${FOOTER_LINK}">Unsubscribe from these emails</a><br />${COMPANY_LEGAL_NAME}&nbsp;&middot;&nbsp;${addressHtml(street)}</p>`),
  ].join("\n");
}

function personalFooterText(footer: MarketingFooter): string {
  return `---
Unsubscribe from these emails: ${footer.unsubscribeUrl.trim()}
${COMPANY_LEGAL_NAME} · ${requireAddress(footer.postalAddress)}`;
}

function requireUnsubscribe(url: string | undefined | null): string {
  if (!url || !url.trim()) {
    throw new Error("Product & marketing emails require an unsubscribe URL");
  }
  return url;
}

function requireFooter(footer: MarketingFooter): MarketingFooter {
  return {
    unsubscribeUrl: requireUnsubscribe(footer.unsubscribeUrl),
    postalAddress: requireAddress(footer.postalAddress),
  };
}

// ---------------------------------------------------------------------------
// Type 1 — Personal (from Rich)
// ---------------------------------------------------------------------------

export interface PersonalLayoutProps extends CommonLayoutProps {
  /** Sign-off line. Defaults to "— Rich". */
  signoff?: string;
  /** What follows the name in the greeting. Defaults to ",". */
  greetingSuffix?: string;
  /**
   * Set ONLY for a personal note that is commercial mail (comeback, feature
   * tour): adds the unsubscribe link and "MastersFit LLC · address".
   * Transactional notes (the comp note) leave it unset.
   */
  footer?: MarketingFooter;
}

/** Rich's text signature, under every personal note's sign-off (§2). */
function signatureHtml(): string {
  const S = `font-family:${FONT}; font-size:14px; line-height:1.5; color:${COLOR.muted};`;
  return `<p style="margin:20px 0 0 0; ${S}">Rich Pusateri&nbsp;&middot;&nbsp;Founder, MastersFit&nbsp;&middot;&nbsp;<a href="${SITE_URL}" target="_blank" style="color:${COLOR.muted}; text-decoration:underline;">mastersfit.ai</a></p>`;
}

const SIGNATURE_TEXT = `Rich Pusateri · Founder, MastersFit · ${SITE_URL}`;

/**
 * A plain note from Rich. NO logo, NO buttons (links are inline text): it
 * should read like an email a person typed. Sent From "Rich Pusateri".
 */
export function personalLayout(props: PersonalLayoutProps): RenderedEmail {
  const signoff = props.signoff ?? "— Rich";
  const footer = props.footer ? requireFooter(props.footer) : null;
  const rows = [
    bodyRows(props.firstName, props.blocks, props.greetingSuffix),
    row(`<p style="margin:8px 0 0 0; ${BODY}">${escapeHtml(signoff)}</p>\n${signatureHtml()}`),
    footer ? row(`<div style="height:24px; line-height:24px; font-size:1px;">&nbsp;</div>`) : "",
    footer ? personalFooterRows(footer) : "",
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    bodyText(props.firstName, props.blocks, props.greetingSuffix),
    toPlain(signoff),
    SIGNATURE_TEXT,
    footer ? personalFooterText(footer) : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    html: shell({ title: props.title, preheader: props.preheader, rows }),
    text: `${text}\n`,
  };
}

// ---------------------------------------------------------------------------
// Type 2 — Welcome / relationship (from MastersFit, signed by Rich)
// ---------------------------------------------------------------------------

export type WelcomeLayoutProps = CommonLayoutProps;

/**
 * Relationship mail: logo header, the body, Rich's founder signature, and the
 * transactional footer (no unsubscribe, no postal address; it confirms
 * something the customer just did). Sent From "MastersFit", Reply-To Rich.
 */
export function welcomeLayout(props: WelcomeLayoutProps): RenderedEmail {
  const rows = [
    logoHeaderHtml(),
    bodyRows(props.firstName, props.blocks),
    row(`<p style="margin:8px 0 32px 0; ${BODY}">&mdash; Rich<br />Founder, MastersFit</p>`),
    ruleRow(),
    row(transactionalFooterHtml()),
  ].join("\n");

  return {
    html: shell({ title: props.title, preheader: props.preheader, rows }),
    text: `${bodyText(props.firstName, props.blocks)}

- Rich
Founder, MastersFit

---
${TRANSACTIONAL_FOOTER_TEXT}
`,
  };
}

// ---------------------------------------------------------------------------
// Type 3 — Product & marketing (from MastersFit, unsubscribe + address)
// ---------------------------------------------------------------------------

export interface NudgeLayoutProps
  extends Omit<CommonLayoutProps, "blocks">,
    MarketingFooter {
  /** The short message. Paragraphs only — keep it to two or three. */
  paragraphs: string[];
  /** The ONE button, placed after the message. */
  button: { label: string; href: string };
  /** Optional short note from Rich under the button. */
  note?: RichNote;
}

/**
 * The sign-off rule (§4): an email carrying "A note from Rich" is already
 * signed by Rich, so "— MastersFit" appears only when the note is left out.
 */
function brandSignoffRow(note: RichNote | undefined): string {
  return note ? "" : row(`<p style="margin:0 0 32px 0; ${BODY}">&mdash; MastersFit</p>`);
}

/**
 * One short message, one button, an optional note from Rich. Footer carries
 * the unsubscribe link and postal address — the caller must ALSO send
 * List-Unsubscribe headers and honour `email_opted_out_at`.
 */
export function nudgeLayout(props: NudgeLayoutProps): RenderedEmail {
  const footer = requireFooter(props);
  const blocks: EmailBlock[] = [
    ...props.paragraphs.map((text): EmailBlock => ({ kind: "paragraph", text })),
    { kind: "button", ...props.button },
  ];

  const rows = [
    logoHeaderHtml(),
    bodyRows(props.firstName, blocks),
    props.note ? row(richNoteHtml(props.note)) : "",
    brandSignoffRow(props.note),
    marketingFooterRows(footer),
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    bodyText(props.firstName, blocks),
    props.note ? richNoteText(props.note) : "- MastersFit",
    marketingFooterText(footer),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    html: shell({ title: props.title, preheader: props.preheader, rows }),
    text: `${text}\n`,
  };
}

export interface EmailImage {
  /** https URL. Host it on the website (www.mastersfit.ai), final URL — no redirects. */
  src: string;
  alt: string;
  /** Intrinsic display width in px (max 536 = the column). Height scales. */
  width?: number;
}

export interface AnnouncementSection {
  title: string;
  body: string;
  image?: EmailImage;
}

export interface AnnouncementLayoutProps
  extends Omit<CommonLayoutProps, "blocks" | "firstName">,
    MarketingFooter {
  /** Big headline at the top ("Three new things in MastersFit"). */
  headline: string;
  /** Pass null to omit the greeting. */
  firstName: string | null;
  /** Hero image, 1072x560 at 2x (536x280 shown). Optional. */
  hero?: EmailImage;
  /** Optional short intro paragraph under the greeting. */
  intro?: string;
  /** The feature sections, in order. Keep each body to two or three sentences. */
  sections: AnnouncementSection[];
  /** The ONE primary button, after the last section. */
  button: { label: string; href: string };
  note?: RichNote;
}

/** Column width inside the 32px side padding. */
const COLUMN = WIDTH - 64;

function imageHtml(img: EmailImage, marginBottom: number): string {
  const w = Math.min(img.width ?? COLUMN, COLUMN);
  return `<img class="feature-img" src="${safeSrc(img.src)}" width="${w}" alt="${escapeHtml(img.alt)}" style="display:block; width:100%; max-width:${w}px; height:auto; border:0; border-radius:12px; margin:0 0 ${marginBottom}px 0;" />`;
}

/**
 * Header → headline → optional hero → greeting → intro → feature sections
 * (optional screenshot, title, paragraph) → ONE button → optional note from
 * Rich → footer (§4, 08 Announcement).
 */
export function announcementLayout(props: AnnouncementLayoutProps): RenderedEmail {
  const footer = requireFooter(props);

  const sectionRows = props.sections.map((s) =>
    row(`${s.image ? imageHtml(s.image, 16) : ""}<p style="margin:0 0 6px 0; font-family:${FONT}; font-size:19px; line-height:1.35; font-weight:700; color:${COLOR.text};">${escapeHtml(s.title)}</p>
<p style="margin:0 0 28px 0; ${BODY}">${escapeHtml(s.body)}</p>`)
  );

  const rows = [
    logoHeaderHtml(),
    row(`<h1 style="margin:0 0 20px 0; font-family:${FONT}; font-size:28px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; color:${COLOR.ink};">${escapeHtml(props.headline)}</h1>`),
    props.hero ? row(imageHtml(props.hero, 28)) : "",
    greetingHtml(props.firstName) ? row(greetingHtml(props.firstName)) : "",
    props.intro ? row(`<p style="margin:0 0 28px 0; ${BODY}">${escapeHtml(props.intro)}</p>`) : "",
    ...sectionRows,
    row(buttonHtml(props.button.label, props.button.href)),
    props.note ? row(richNoteHtml(props.note)) : "",
    brandSignoffRow(props.note),
    marketingFooterRows(footer),
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    toPlain(props.headline).toUpperCase(),
    props.firstName === null ? "" : greetingText(props.firstName).trim(),
    props.intro ? toPlain(props.intro) : "",
    ...props.sections.map((s) => `${toPlain(s.title)}\n${toPlain(s.body)}`),
    `${toPlain(props.button.label)}: ${props.button.href.trim()}`,
    props.note ? richNoteText(props.note) : "- MastersFit",
    marketingFooterText(footer),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    html: shell({ title: props.title, preheader: props.preheader, rows }),
    text: `${text}\n`,
  };
}

// ---------------------------------------------------------------------------
// Type 4 — Account & billing (unsigned)
// ---------------------------------------------------------------------------

export interface AccountLayoutProps extends CommonLayoutProps {
  /** Optional heading above the greeting ("Verify your email"). */
  heading?: string;
  /** A line above the legal row, e.g. why they got it or "If you didn't request this…". */
  footerNote?: string;
}

/**
 * Account & billing mail — codes, renewal notices. Logo header, the facts,
 * NO signature, no unsubscribe (it's transactional), the transactional footer.
 * Sent From "MastersFit", Reply-To Rich.
 */
export function accountLayout(props: AccountLayoutProps): RenderedEmail {
  const rows = [
    logoHeaderHtml(),
    props.heading
      ? row(`<h1 style="margin:0 0 16px 0; font-family:${FONT}; font-size:24px; line-height:1.3; font-weight:700; letter-spacing:-0.01em; color:${COLOR.ink};">${escapeHtml(props.heading)}</h1>`)
      : "",
    bodyRows(props.firstName, props.blocks),
    ruleRow(),
    row(`${props.footerNote ? `<p style="margin:0 0 12px 0; ${SMALL}">${escapeHtml(props.footerNote)}</p>\n` : ""}${transactionalFooterHtml()}`),
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    props.heading ? toPlain(props.heading) : "",
    bodyText(props.firstName, props.blocks),
    `---${props.footerNote ? `\n${toPlain(props.footerNote)}` : ""}\n${TRANSACTIONAL_FOOTER_TEXT}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    html: shell({ title: props.title, preheader: props.preheader, rows }),
    text: `${text}\n`,
  };
}

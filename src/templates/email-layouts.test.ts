import { describe, it, expect } from "@jest/globals";
import {
  accountLayout,
  announcementLayout,
  nudgeLayout,
  personalLayout,
  welcomeLayout,
} from "@/templates/email-layouts";
import { streetAddress } from "@/templates/email-shared";
import { sampleAnnouncementTemplate } from "@/templates/sample-announcement-email";

const UNSUB = "https://www.mastersfit.ai/unsubscribe?token=abc&x=1";
const ADDRESS = "123 Sample Street, Anytown, ST 00000";
const HOSTILE = `<script>alert("x")</script>`;

const base = { title: "T", preheader: "P", firstName: "Jordan" };
const footer = { unsubscribeUrl: UNSUB, postalAddress: ADDRESS };
const nudge = (over: Record<string, unknown> = {}) =>
  nudgeLayout({ ...base, paragraphs: ["a"], button: { label: "Go", href: "https://x.test" }, ...footer, ...over });

describe("email layouts", () => {
  it("escapes every interpolated string", () => {
    const outs = [
      personalLayout({ ...base, firstName: HOSTILE, blocks: [{ kind: "paragraph", text: HOSTILE }, { kind: "tip", title: HOSTILE, path: HOSTILE, body: HOSTILE }] }),
      welcomeLayout({ ...base, blocks: [{ kind: "bullets", intro: HOSTILE, items: [{ lead: HOSTILE, text: HOSTILE }] }] }),
      accountLayout({ ...base, heading: HOSTILE, blocks: [{ kind: "code", label: HOSTILE, value: HOSTILE }, { kind: "detail", label: HOSTILE, value: HOSTILE, sub: HOSTILE }], footerNote: HOSTILE }),
      nudge({ paragraphs: [HOSTILE], button: { label: HOSTILE, href: "https://x.test" }, note: { text: HOSTILE } }),
      announcementLayout({
        ...base,
        title: HOSTILE,
        preheader: HOSTILE,
        headline: HOSTILE,
        intro: HOSTILE,
        sections: [{ title: HOSTILE, body: HOSTILE, image: { src: "https://x.test/a.png", alt: HOSTILE } }],
        button: { label: HOSTILE, href: "https://x.test" },
        ...footer,
        postalAddress: HOSTILE,
      }),
    ];
    for (const { html } of outs) {
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    }
  });

  it("renders a name containing <b>& as literal text", () => {
    const { html } = personalLayout({ ...base, firstName: "<b>&", blocks: [] });
    expect(html).toContain("Hi &lt;b&gt;&amp;,");
    expect(html).not.toContain("<b>&");
  });

  it("refuses custom-scheme and javascript: links", () => {
    for (const href of ["masters-fit://x", "javascript:alert(1)"]) {
      expect(() => nudge({ button: { label: "Go", href } })).toThrow();
      expect(() =>
        accountLayout({ ...base, blocks: [{ kind: "paragraph", text: "manage it", link: { text: "manage it", href } }] })
      ).toThrow();
    }
  });

  it("applies the shared rules: 17px body, near-black underlined links, no green, padded preheader", () => {
    const { html } = nudge();
    expect(html).toContain("font-size:17px");
    expect(html).toContain("a { color:#0A0A0A; text-decoration:underline; }");
    expect(html).not.toMatch(/1A6B4A/i);
    expect(html.match(/&zwnj;&nbsp;/g)?.length).toBe(90);
  });

  it("branded types carry the logo tile with alt text and the live wordmark; personal does not", () => {
    for (const { html } of [
      nudge(),
      welcomeLayout({ ...base, blocks: [] }),
      accountLayout({ ...base, blocks: [] }),
    ]) {
      expect(html).toContain('src="https://www.mastersfit.ai/assets/email/logo-tile@2x.png" width="52" height="52" alt="MastersFit"');
      expect(html).toMatch(/font-size:22px; line-height:1.2; font-weight:700;[^>]*>MastersFit</);
    }
    expect(personalLayout({ ...base, blocks: [] }).html).not.toContain("logo-tile");
  });

  it("the button is outlined, never filled", () => {
    const { html } = nudge();
    expect(html).toContain("border:1.5px solid #0A0A0A");
    expect(html).toContain("font-size:15px; font-weight:600");
    expect(html).not.toMatch(/background-color:#0A0A0A/);
  });

  it("type 3 layouts require an unsubscribe link and an address, and carry both", () => {
    expect(() => nudge({ unsubscribeUrl: "" })).toThrow(/unsubscribe/);
    expect(() => nudge({ postalAddress: "  " })).toThrow(/postal address/);

    const ann = sampleAnnouncementTemplate({ name: "Jordan Sample", unsubscribeUrl: UNSUB, postalAddress: ADDRESS, openAppUrl: "https://x.test" });
    for (const { html, text } of [nudge(), ann]) {
      expect(html).toContain(`href="${UNSUB.replace(/&/g, "&amp;")}"`);
      expect(html).toContain("You're receiving this because you have a MastersFit account.");
      expect(html).toContain(`MastersFit LLC<br />${ADDRESS}`);
      expect(text).toContain(`Unsubscribe from these emails: ${UNSUB}`);
      expect(text).toContain(`MastersFit LLC\n${ADDRESS}`);
    }
  });

  it("signs '— MastersFit' only when there is no note from Rich", () => {
    const withNote = nudge({ note: { text: "Reply to me." } });
    expect(withNote.html).toContain("A note from Rich");
    expect(withNote.html).not.toContain("&mdash; MastersFit");
    expect(withNote.text).not.toContain("- MastersFit");

    const without = nudge();
    expect(without.html).toContain("&mdash; MastersFit");
    expect(without.text).toContain("- MastersFit");
  });

  it("types 1 (transactional), 2 and 4 have no unsubscribe and no postal address", () => {
    const outs = [
      personalLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] }),
      welcomeLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] }),
      accountLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] }),
    ];
    for (const { html, text } of outs) {
      expect(html).not.toMatch(/unsubscribe/i);
      expect(text).not.toMatch(/unsubscribe/i);
      expect(text).not.toContain(ADDRESS);
    }
    // §1.4 transactional footer on types 2 and 4, never "© MastersFit".
    for (const { html, text } of outs.slice(1)) {
      expect(html).toMatch(/MastersFit LLC&nbsp;&middot;&nbsp;<a [^>]*>Privacy<\/a>/);
      expect(text).toContain("MastersFit LLC");
      expect(html).not.toMatch(/©|&copy;/);
    }
  });

  it("the personal variant of the commercial footer is just unsubscribe + 'MastersFit LLC · address'", () => {
    const { html, text } = personalLayout({ ...base, blocks: [], footer });
    expect(html).toContain("Unsubscribe from these emails</a><br />MastersFit LLC&nbsp;&middot;&nbsp;123 Sample Street");
    expect(html).not.toContain("You're receiving this");
    expect(html).not.toContain(">Privacy<");
    expect(text).toContain(`MastersFit LLC · ${ADDRESS}`);
  });

  it("signs each type correctly", () => {
    const personal = personalLayout({ ...base, blocks: [] });
    expect(personal.text).toContain("- Rich\n\nRich Pusateri · Founder, MastersFit · https://www.mastersfit.ai");
    expect(personal.html).toContain('href="https://www.mastersfit.ai"');
    expect(welcomeLayout({ ...base, blocks: [] }).text).toContain("- Rich\nFounder, MastersFit");
    const account = accountLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] });
    expect(account.text).not.toMatch(/- Rich|- MastersFit|The MastersFit team/);
  });

  it("greets by first name, generically when blank, and not at all when null", () => {
    expect(personalLayout({ ...base, blocks: [] }).text.startsWith("Hi Jordan,")).toBe(true);
    expect(personalLayout({ ...base, firstName: " ", blocks: [] }).text.startsWith("Hi there,")).toBe(true);
    expect(personalLayout({ ...base, firstName: null, blocks: [] }).text).not.toContain("Hi ");
    expect(personalLayout({ ...base, greetingSuffix: " —", blocks: [] }).text.startsWith("Hi Jordan -")).toBe(true);
  });

  it("renders an inline paragraph link, bold when asked, with the URL in the text half", () => {
    const { html, text } = accountLayout({
      ...base,
      blocks: [{ kind: "paragraph", text: "You can manage or cancel anytime.", link: { text: "manage or cancel anytime", href: "https://www.mastersfit.ai/manage-subscription", bold: true } }],
    });
    expect(html).toContain('You can <a href="https://www.mastersfit.ai/manage-subscription" target="_blank" style="color:#0A0A0A; text-decoration:underline; font-weight:700;">manage or cancel anytime</a>.');
    expect(text).toContain("You can manage or cancel anytime (https://www.mastersfit.ai/manage-subscription).");
  });
});

describe("streetAddress", () => {
  it("strips a leading company name so the footer doesn't print it twice", () => {
    expect(streetAddress("MastersFit LLC\n1 Main St")).toBe("1 Main St");
    expect(streetAddress("MastersFit, LLC, 1 Main St")).toBe("1 Main St");
    expect(streetAddress("  1 Main St  ")).toBe("1 Main St");
  });
});

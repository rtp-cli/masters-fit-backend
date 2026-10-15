import { describe, it, expect } from "@jest/globals";
import {
  accountLayout,
  announcementLayout,
  nudgeLayout,
  personalLayout,
  welcomeLayout,
} from "@/templates/email-layouts";
import { MASTERSFIT_POSTAL_ADDRESS } from "@/templates/email-shared";
import { sampleAnnouncementTemplate } from "@/templates/sample-announcement-email";

const UNSUB = "https://api.example.com/api/email-preferences/unsubscribe?token=abc&x=1";
const HOSTILE = `<script>alert("x")</script>`;

const base = { title: "T", preheader: "P", firstName: "Jordan" };

describe("email layouts", () => {
  it("escapes every interpolated string", () => {
    const outs = [
      personalLayout({ ...base, firstName: HOSTILE, blocks: [{ kind: "paragraph", text: HOSTILE }] }),
      welcomeLayout({ ...base, blocks: [{ kind: "bullets", intro: HOSTILE, items: [{ lead: HOSTILE, text: HOSTILE }] }] }),
      accountLayout({ ...base, heading: HOSTILE, blocks: [{ kind: "code", label: HOSTILE, value: HOSTILE }], footerNote: HOSTILE }),
      nudgeLayout({ ...base, paragraphs: [HOSTILE], button: { label: HOSTILE, href: "https://x.test" }, note: { text: HOSTILE }, unsubscribeUrl: UNSUB }),
      announcementLayout({
        ...base,
        title: HOSTILE,
        preheader: HOSTILE,
        headline: HOSTILE,
        intro: HOSTILE,
        sections: [{ title: HOSTILE, body: HOSTILE, image: { src: "https://x.test/a.png", alt: HOSTILE } }],
        button: { label: HOSTILE, href: "https://x.test" },
        unsubscribeUrl: UNSUB,
      }),
    ];
    for (const { html } of outs) {
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    }
  });

  it("refuses custom-scheme and javascript: links", () => {
    for (const href of ["masters-fit://x", "javascript:alert(1)"]) {
      expect(() => nudgeLayout({ ...base, paragraphs: ["a"], button: { label: "Go", href }, unsubscribeUrl: UNSUB })).toThrow();
    }
  });

  it("type 3 layouts require an unsubscribe link and carry it plus the postal address", () => {
    expect(() => nudgeLayout({ ...base, paragraphs: ["a"], button: { label: "Go", href: "https://x.test" }, unsubscribeUrl: "" })).toThrow(/unsubscribe/);

    const nudge = nudgeLayout({ ...base, paragraphs: ["a"], button: { label: "Go", href: "https://x.test" }, unsubscribeUrl: UNSUB });
    const ann = sampleAnnouncementTemplate({ name: "Jordan Sample", unsubscribeUrl: UNSUB, openAppUrl: "https://x.test" });
    for (const { html, text } of [nudge, ann]) {
      expect(html).toContain(`href="${UNSUB.replace(/&/g, "&amp;")}"`);
      expect(html).toContain("1606 NW 106th Ter<br />Kansas City, MO 64155-1656");
      expect(text).toContain(`Unsubscribe from these emails: ${UNSUB}`);
      expect(text).toContain(MASTERSFIT_POSTAL_ADDRESS);
      expect(text).toContain("- MastersFit");
    }
  });

  it("types 1, 2 and 4 have no unsubscribe and no postal address", () => {
    const outs = [
      personalLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] }),
      welcomeLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] }),
      accountLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] }),
    ];
    for (const { html, text } of outs) {
      expect(html).not.toMatch(/unsubscribe/i);
      expect(text).not.toMatch(/unsubscribe/i);
      expect(text).not.toContain("1606 NW");
    }
  });

  it("signs each type correctly", () => {
    expect(personalLayout({ ...base, blocks: [] }).text.trimEnd().endsWith("- Rich")).toBe(true);
    expect(personalLayout({ ...base, blocks: [] }).html).not.toContain("logo");
    expect(welcomeLayout({ ...base, blocks: [] }).text).toContain("- Rich\nFounder, MastersFit");
    const account = accountLayout({ ...base, blocks: [{ kind: "paragraph", text: "a" }] });
    expect(account.text).not.toMatch(/- Rich|- MastersFit|The MastersFit team/);
  });

  it("greets by first name, generically when blank, and not at all when null", () => {
    expect(personalLayout({ ...base, blocks: [] }).text.startsWith("Hi Jordan,")).toBe(true);
    expect(personalLayout({ ...base, firstName: " ", blocks: [] }).text.startsWith("Hi there,")).toBe(true);
    expect(personalLayout({ ...base, firstName: null, blocks: [] }).text).not.toContain("Hi ");
  });
});

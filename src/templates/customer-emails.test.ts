import { describe, it, expect } from "@jest/globals";
import { compGrantedTemplate } from "@/templates/comp-granted-email";
import { comebackTemplate } from "@/templates/comeback-email";
import { featureTourTemplate } from "@/templates/feature-tour-email";

/**
 * Per-email checks for the template refresh (handoff SPEC §2-§5). The shared
 * rules themselves are covered in email-layouts.test.ts; this file pins the
 * per-email copy and branches that are easy to get wrong.
 */

const UNSUB = "https://www.mastersfit.ai/unsubscribe?token=1.abc";
const ADDRESS = "123 Sample Street, Anytown, ST 00000";
const SIGNATURE = "Rich Pusateri · Founder, MastersFit · https://www.mastersfit.ai";

describe("type 1 · personal", () => {
  it("comp granted: transactional, first name only, signed with the text signature", () => {
    const { html, text } = compGrantedTemplate({ name: "Jordan Sample" });
    expect(text.startsWith("Hi Jordan,")).toBe(true);
    expect(text).not.toContain("Sample");
    expect(text).toContain(SIGNATURE);
    expect(html).not.toMatch(/unsubscribe/i);
    expect(html).not.toContain("logo-tile");
  });

  it("comeback: the third paragraph branches on comp status", () => {
    const render = (isComped: boolean) =>
      comebackTemplate({ name: "Jordan", daysSinceSignup: 30, isComped, unsubscribeUrl: UNSUB, postalAddress: ADDRESS });

    const comped = render(true);
    expect(comped.text).toContain(
      "Your complimentary access is still active, so there's nothing to renew or purchase. Open the app and it'll offer to build you a fresh week."
    );

    const other = render(false);
    expect(other.html).not.toMatch(/complimentary/i);
    expect(other.text).not.toMatch(/complimentary/i);
    expect(other.text).toContain("\n\nOpen the app and it'll offer to build you a fresh week.\n\n");

    for (const { html, text } of [comped, other]) {
      expect(text.startsWith("Hi Jordan -")).toBe(true);
      expect(text).toContain(SIGNATURE);
      expect(text).toContain(`Unsubscribe from these emails: ${UNSUB}`);
      expect(text).toContain(`MastersFit LLC · ${ADDRESS}`);
      expect(html).not.toContain("logo-tile");
      expect(html).not.toContain("You're receiving this");
    }
  });

  it("feature tour: each path is its own muted paragraph under the bold title", () => {
    const { html, text } = featureTourTemplate({ name: "Jordan", unsubscribeUrl: UNSUB, postalAddress: ADDRESS });
    expect(html).toMatch(
      /font-weight:700; color:#1A1A1A;">1\. Send feedback without leaving the app<\/p>\n<p style="[^"]*font-size:15px; line-height:1.5; color:#5A5A5A;">Tap the person icon → Feedback\.<\/p>/
    );
    expect(text).toContain("1. Send feedback without leaving the app\nTap the person icon -> Feedback.\nBug, idea");
    expect(text).toContain(SIGNATURE);
    expect(text).toContain(`MastersFit LLC · ${ADDRESS}`);
  });
});

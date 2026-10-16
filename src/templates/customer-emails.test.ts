import { describe, it, expect } from "@jest/globals";
import { compGrantedTemplate } from "@/templates/comp-granted-email";
import { comebackTemplate } from "@/templates/comeback-email";
import { featureTourTemplate } from "@/templates/feature-tour-email";
import { subscriberWelcomeTemplate } from "@/templates/subscriber-welcome-email";
import { onboardingNudgeTemplate } from "@/templates/onboarding-nudge-email";
import { activationNudgeTemplate } from "@/templates/activation-nudge-email";

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

describe("type 2 · welcome", () => {
  it("outlined 'Open MastersFit' button to /open, the new benefit line, and the transactional footer", () => {
    const { html, text } = subscriberWelcomeTemplate({ name: "Jordan Sample", isTrial: false, openAppUrl: "https://www.mastersfit.ai/open" });
    expect(html).toMatch(/href="https:\/\/www\.mastersfit\.ai\/open"[^>]*>Open MastersFit<\/a>/);
    expect(html).toContain("border:1.5px solid #0A0A0A");
    expect(text).toContain("Track your consistency, strength trends, training volume, and personal records.");
    expect(text).toContain("- Rich\nFounder, MastersFit");
    expect(html).not.toMatch(/unsubscribe/i);
  });

  it("trial variant changes only the opening line (no trial box)", () => {
    const trial = subscriberWelcomeTemplate({ name: "Jordan", isTrial: true, openAppUrl: "https://www.mastersfit.ai/open" });
    expect(trial.text).toContain("Thanks for starting your MastersFit+ free trial. Nothing has been charged yet.");
    expect(trial.html).not.toMatch(/your trial/i);
  });
});

describe("type 3 · product & marketing", () => {
  const footer = { unsubscribeUrl: UNSUB, postalAddress: ADDRESS };

  it("onboarding nudge: verbatim copy, note from Rich, no '— MastersFit'", () => {
    const { html, text } = onboardingNudgeTemplate({ name: "Jordan", continueUrl: "https://www.mastersfit.ai/continue", ...footer });
    expect(text).toContain("You started setting up MastersFit a couple of days ago but didn't make it to the end, so you haven't got your first plan yet.");
    expect(text).toContain("It takes about two minutes to finish: a few questions about your goals, your schedule, and what equipment you've got. Then it builds your week.");
    expect(text).toContain("Finish setting up: https://www.mastersfit.ai/continue");
    expect(html).toContain("A note from Rich");
    expect(html).not.toContain("&mdash; MastersFit");
    expect(text).toContain(`MastersFit LLC\n${ADDRESS}`);
  });

  it("activation nudge: names the session, falls back to the plan, button to /open", () => {
    const named = activationNudgeTemplate({ name: "Jordan", planName: "Foundations", firstSessionName: "Full-Body Strength", startUrl: "https://www.mastersfit.ai/open", ...footer });
    expect(named.text).toContain("Your Full-Body Strength session is built and waiting in the app. You haven't started it yet.");
    expect(named.text).toContain("There's nothing to set up and nothing to decide. Open the app, tap Start, and it walks you through one exercise at a time. You can stop partway and it keeps what you did.");
    expect(named.text).toContain("Start your first workout: https://www.mastersfit.ai/open");
    expect(named.text).toContain("If the plan isn't right - too long, too hard, wrong equipment - just reply and tell me.");

    const planOnly = activationNudgeTemplate({ name: "Jordan", planName: "Foundations", firstSessionName: null, startUrl: "https://www.mastersfit.ai/open", ...footer });
    expect(planOnly.text).toContain("Your Foundations session is built");
    const nothing = activationNudgeTemplate({ name: "Jordan", planName: "", firstSessionName: null, startUrl: "https://www.mastersfit.ai/open", ...footer });
    expect(nothing.text).toContain("Your plan is built and waiting in the app.");
  });
});

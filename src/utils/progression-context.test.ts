import { describe, it, expect } from "@jest/globals";
import { buildProgressionContext } from "@/utils/progression-context";

describe("buildProgressionContext [LR-014]", () => {
  it("returns empty string when there's no previous week data", () => {
    expect(buildProgressionContext(null)).toBe("");
  });

  it("nudges intensity up for a fully/mostly completed previous week (>=80%)", () => {
    const context = buildProgressionContext(100);
    expect(context).toContain("Nudge intensity/volume up");
    expect(context).toContain("100%");
  });

  it("nudges intensity down/holds steady for a low-completion previous week (<50%)", () => {
    const context = buildProgressionContext(20);
    expect(context).toContain("Hold intensity/volume steady or ease back");
    expect(context).toContain("20%");
  });

  it("holds baseline for a moderate previous week (50-79%)", () => {
    const context = buildProgressionContext(65);
    expect(context).toContain("Keep this week's intensity/volume roughly the same");
    expect(context).toContain("65%");
  });

  it("treats the 80% boundary as the high case, not moderate", () => {
    expect(buildProgressionContext(80)).toContain("Nudge intensity/volume up");
  });

  it("treats the 50% boundary as moderate, not low", () => {
    expect(buildProgressionContext(50)).toContain(
      "Keep this week's intensity/volume roughly the same"
    );
  });
});

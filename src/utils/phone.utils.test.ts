import { describe, it, expect } from "@jest/globals";

import { formatUsPhone, maskPhone, normalizeUsPhone } from "@/utils/phone.utils";

describe("normalizeUsPhone", () => {
  it.each([
    ["(312) 555-0123", "+13125550123"],
    ["312.555.0123", "+13125550123"],
    ["3125550123", "+13125550123"],
    ["1 312 555 0123", "+13125550123"],
    ["+1 312-555-0123", "+13125550123"],
    ["  +13125550123  ", "+13125550123"],
    ["(416) 555-0199", "+14165550199"], // Canada shares +1
  ])("normalizes %s", (input, expected) => {
    expect(normalizeUsPhone(input)).toBe(expected);
  });

  it.each([
    ["+44 20 7946 0958", "non-+1 international"],
    ["555-0123", "too short"],
    ["312555012345", "too long"],
    ["(012) 555-0123", "area code starts 0"],
    ["(112) 555-0123", "area code starts 1"],
    ["(312) 155-0123", "exchange starts 1"],
    ["(911) 555-0123", "N11 area code"],
    ["(312) 411-0123", "N11 exchange"],
    ["", "empty"],
  ])("rejects %s (%s)", (input) => {
    expect(normalizeUsPhone(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeUsPhone(undefined)).toBeNull();
    expect(normalizeUsPhone(3125550123)).toBeNull();
    expect(normalizeUsPhone({ phone: "3125550123" })).toBeNull();
  });
});

describe("maskPhone / formatUsPhone", () => {
  it("masks all but the last four digits", () => {
    expect(maskPhone("+13125550123")).toBe("+1•••••••0123");
    expect(maskPhone(null)).toBe("");
  });

  it("formats E.164 +1 for display", () => {
    expect(formatUsPhone("+13125550123")).toBe("(312) 555-0123");
    expect(formatUsPhone(null)).toBe("");
  });
});

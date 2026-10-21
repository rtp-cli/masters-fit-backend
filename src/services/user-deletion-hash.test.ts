import { describe, it, expect } from "@jest/globals";

import { deletionIdentifierHash, hashEmail } from "@/services/user.service";

describe("deletionIdentifierHash", () => {
  it("hashes the email when there is one (unchanged behaviour)", () => {
    expect(deletionIdentifierHash("Dana@Example.com", "+13125550123")).toBe(
      hashEmail("dana@example.com")
    );
  });

  it("falls back to the phone for a phone-only account instead of crashing", () => {
    expect(deletionIdentifierHash(null, "+13125550123")).toBe(hashEmail("+13125550123"));
  });

  it("refuses an account with neither (the DB CHECK makes this impossible)", () => {
    expect(() => deletionIdentifierHash(null, null)).toThrow();
  });
});

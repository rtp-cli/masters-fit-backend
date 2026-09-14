import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/utils/email-token";

/**
 * The signature on an unsubscribe link is the only thing stopping someone from
 * walking the id space and opting out every user, so the tamper cases get more
 * attention here than the happy path does.
 */
describe("unsubscribe tokens", () => {
  const KEYS = ["EMAIL_TOKEN_SECRET", "JWT_SECRET"];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.EMAIL_TOKEN_SECRET = "test-secret-value";
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("round-trips a user id", () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(148))).toBe(148);
  });

  it("falls back to JWT_SECRET when no dedicated secret is set", () => {
    delete process.env.EMAIL_TOKEN_SECRET;
    process.env.JWT_SECRET = "fallback-secret";
    expect(verifyUnsubscribeToken(signUnsubscribeToken(7))).toBe(7);
  });

  it("refuses to sign with no secret configured", () => {
    delete process.env.EMAIL_TOKEN_SECRET;
    expect(() => signUnsubscribeToken(1)).toThrow(/must be set/i);
  });

  it("rejects a token whose user id was swapped", () => {
    // The attack this exists to stop: take your own valid link, change the
    // number, unsubscribe somebody else.
    const mine = signUnsubscribeToken(148);
    const signature = mine.slice(mine.lastIndexOf(".") + 1);
    expect(verifyUnsubscribeToken(`149.${signature}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signUnsubscribeToken(148);
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signUnsubscribeToken(148);
    process.env.EMAIL_TOKEN_SECRET = "a-different-secret";
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("returns null for junk instead of throwing", () => {
    // These reach a public endpoint, so a throw here is a 500 on a crawler hit.
    for (const junk of [undefined, "", ".", "abc", "148", "148.", ".sig", "-1.sig"]) {
      expect(verifyUnsubscribeToken(junk as string | undefined)).toBeNull();
    }
  });

  it("does not expire", () => {
    // An unsubscribe link found in an old folder must still work; an expiring
    // opt-out is a compliance failure, not a security feature.
    const token = signUnsubscribeToken(42);
    expect(verifyUnsubscribeToken(token)).toBe(42);
  });
});

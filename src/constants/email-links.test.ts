import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  listUnsubscribeHeaders,
  unsubscribePageUrl,
  unsubscribeUrlFor,
} from "@/constants/email-links";
import { verifyUnsubscribeToken } from "@/utils/email-token";

describe("email links", () => {
  const KEYS = ["EMAIL_TOKEN_SECRET", "JWT_SECRET", "UNSUBSCRIBE_PAGE_URL"];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.EMAIL_TOKEN_SECRET = "test-secret-value";
    delete process.env.UNSUBSCRIBE_PAGE_URL;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("points unsubscribe at the website, never the Render host", () => {
    expect(unsubscribePageUrl()).toBe("https://www.mastersfit.ai/unsubscribe");
    const url = unsubscribeUrlFor(148);
    expect(url.startsWith("https://www.mastersfit.ai/unsubscribe?token=")).toBe(true);
    expect(url).not.toContain("onrender.com");
    const token = decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
    expect(verifyUnsubscribeToken(token)).toBe(148);
  });

  it("is overridable by env, trailing slash stripped", () => {
    process.env.UNSUBSCRIBE_PAGE_URL = "https://staging.example.com/unsubscribe/";
    expect(unsubscribeUrlFor(1).startsWith("https://staging.example.com/unsubscribe?token=")).toBe(true);
  });

  it("builds RFC 8058 one-click headers around ONE https URL", () => {
    const url = unsubscribeUrlFor(7);
    expect(listUnsubscribeHeaders(url)).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

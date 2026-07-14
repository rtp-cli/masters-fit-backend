import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";

/**
 * Default-deny authorization coverage (R-3).
 *
 * Enforces the P0 invariant: every mounted HTTP route composes `requireAuth`
 * unless it is on the explicit public allowlist. This is a STATIC source scan
 * (not a runtime app import) on purpose — it needs no DB/Redis, never flakes in
 * CI, and fails the moment a new route is added without auth. If you add a
 * genuinely public route, add it to PUBLIC_ALLOWLIST with a justification.
 *
 * It intentionally checks only for the presence of `requireAuth`; the
 * per-route ownership/self/admin guards (requireSelf, requireOwnership,
 * requireAdmin) always accompany requireAuth and are verified by behavior
 * tests, not by this coverage gate.
 */

const ROUTES_DIR = path.join(process.cwd(), "src", "routes");

// Whole files exempt from the auth requirement: the authentication entrypoint
// itself (login / OTP / token refresh / waiver) cannot require a prior JWT.
const EXEMPT_FILES = new Set<string>(["auth.routes.ts"]);

// Individually public routes (no JWT). Each MUST have an explicit reason.
const PUBLIC_ALLOWLIST: Record<string, Array<{ method: string; route: string }>> =
  {
    // Plans list is public marketing data; webhook is authenticated by a
    // RevenueCat shared secret (see handleRevenueCatWebhook), not a user JWT.
    "subscription.routes.ts": [
      { method: "get", route: "/plans" },
      { method: "post", route: "/webhooks/revenuecat" },
    ],
  };

const ROUTE_RE =
  /router\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]([\s\S]*?)(?:async\s*\(|\(\s*req)/g;

describe("authz route coverage (default-deny)", () => {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".routes.ts"));

  it("discovers route files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    if (EXEMPT_FILES.has(file)) continue;

    const src = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
    const re = new RegExp(ROUTE_RE);
    let match: RegExpExecArray | null;

    while ((match = re.exec(src)) !== null) {
      const method = match[1];
      const route = match[2];
      const middlewareChunk = match[3];

      const isPublic = (PUBLIC_ALLOWLIST[file] ?? []).some(
        (r) => r.method === method && r.route === route
      );

      // eslint-disable-next-line no-loop-func
      it(`${file}: ${method.toUpperCase()} ${route} is authenticated or explicitly public`, () => {
        if (isPublic) return;
        expect(middlewareChunk).toContain("requireAuth");
      });
    }
  }
});

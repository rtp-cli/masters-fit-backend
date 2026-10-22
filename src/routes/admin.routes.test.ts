import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Source-level guard (see logs.routes.test.ts for why this isn't an import):
 * every admin-console route must carry requireAuth AND an admin gate, and every
 * state-changing console route must go through adminActionService.run so it
 * lands in admin_action_log.
 */
const source = readFileSync(join(__dirname, "admin.routes.ts"), "utf8");
const blocks = source
  .split(/router\.(?=get|post|put|patch|delete)/)
  .slice(1)
  .map((b) => ({
    method: b.match(/^\w+/)![0],
    // Middleware list only (up to the handler), so comments that follow a
    // route can't satisfy a check meant for the route itself.
    guards: b.slice(0, b.indexOf("async")),
    body: b,
  }));

describe("admin router guards", () => {
  it("finds the console routes", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(7);
  });

  it("every route has requireAuth plus requireRole or requireAdmin", () => {
    for (const b of blocks) {
      expect(b.guards).toContain("requireAuth");
      expect(/requireRole\(|requireAdmin/.test(b.guards)).toBe(true);
    }
  });

  it("every requireRole write route is audited and needs a reason", () => {
    const writes = blocks.filter(
      (b) => b.method !== "get" && b.guards.includes("requireRole(")
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const b of writes) {
      expect(b.body).toContain("adminActionService.run");
      expect(b.body).toContain("A reason is required");
    }
  });
});

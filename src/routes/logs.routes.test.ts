import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Guard against the controller/router drift failure mode: this codebase
 * mounts hand-written Express routers (app.ts), so a controller method
 * without a matching router entry is silently unreachable. block_logs was
 * write-dead for months because POST /block existed only on the controller.
 * See docs/architecture/workout-logging-gap-analysis.md (frontend repo).
 *
 * Deliberately asserts against the route file's SOURCE rather than
 * importing the router: importing it pulls the whole service barrel into
 * ts-jest (this repo's jest.config asks tests to stay import-isolated).
 */
const source = readFileSync(join(__dirname, "logs.routes.ts"), "utf8");

const hasRoute = (method: string, path: string) =>
  new RegExp(`router\\.${method}\\(\\s*"${path.replace(/[/:]/g, (c) => `\\${c}`)}"`).test(
    source
  );

describe("logsRouter wiring", () => {
  it.each([
    ["post", "/exercise"],
    ["post", "/exercise/batch"],
    ["get", "/exercise/:planDayId"],
    ["post", "/block"],
    ["put", "/block/:blockLogId"],
    ["get", "/block/plan-day/:planDayId"],
    ["post", "/workout/day/:planDayId/complete"],
    ["post", "/workout/day/:planDayId/reopen"],
    ["get", "/plan-day/plan-day/:planDayId/latest"],
  ])("wires %s %s", (method, path) => {
    expect(hasRoute(method, path)).toBe(true);
  });

  it("every route carries requireAuth (authz regression guard)", () => {
    const routeBlocks = source.split(/router\.(?:get|post|put|delete)\(/).slice(1);
    for (const block of routeBlocks) {
      expect(block).toContain("requireAuth");
    }
  });
});

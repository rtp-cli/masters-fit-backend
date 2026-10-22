import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const getRole = jest.fn<(userId: number) => Promise<string | null>>();
jest.mock("@/services/admin-role.service", () => ({
  adminRoleService: { getRole: (id: number) => getRole(id) },
}));

import { requireRole } from "./admin-role.middleware";
import { roleAtLeast, isAdminRole } from "@/constants/admin-roles";

function run(minimum: "analyst" | "admin" | "super_admin", req: any) {
  const res: any = { statusCode: 200 };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn(() => res);
  const next = jest.fn();
  return Promise.resolve(requireRole(minimum)(req, res, next)).then(() => ({ res, next }));
}

describe("roleAtLeast", () => {
  it("orders analyst < admin < super_admin", () => {
    expect(roleAtLeast("super_admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("analyst", "admin")).toBe(false);
    expect(roleAtLeast(null, "analyst")).toBe(false);
  });

  it("rejects unknown role strings", () => {
    expect(isAdminRole("owner")).toBe(false);
    expect(isAdminRole("analyst")).toBe(true);
  });
});

describe("requireRole", () => {
  beforeEach(() => {
    getRole.mockReset();
  });

  it("lets a sufficient role through and records it on the request", async () => {
    getRole.mockResolvedValue("admin");
    const req: any = { userId: 7 };
    const { next } = await run("analyst", req);
    expect(next).toHaveBeenCalled();
    expect(req.adminRole).toBe("admin");
  });

  it("403s a role below the minimum", async () => {
    getRole.mockResolvedValue("analyst");
    const { res, next } = await run("admin", { userId: 7 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("403s a non-admin", async () => {
    getRole.mockResolvedValue(null);
    const { res } = await run("analyst", { userId: 7 });
    expect(res.statusCode).toBe(403);
  });

  it("refuses impersonation tokens without even looking up the role", async () => {
    getRole.mockResolvedValue("super_admin");
    const { res, next } = await run("analyst", { userId: 7, impersonatedBy: 1 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(getRole).not.toHaveBeenCalled();
  });

  it("fails closed (500, no next) when the lookup throws", async () => {
    getRole.mockRejectedValue(new Error("db down"));
    const { res, next } = await run("analyst", { userId: 7 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });
});

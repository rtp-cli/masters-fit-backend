import { describe, it, expect, jest } from "@jest/globals";
import { adminActionService } from "./admin-action.service";

/**
 * A fake drizzle db that records the admin_action_log writes. insert() can be
 * told to fail, to prove the action never runs unrecorded.
 */
function fakeDb(opts: { insertFails?: boolean } = {}) {
  const updates: any[] = [];
  const db: any = {
    insert: () => ({
      values: () => ({
        returning: async () => {
          if (opts.insertFails) throw new Error("insert failed");
          return [{ id: 42 }];
        },
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  };
  return { db, updates };
}

const ctx = {
  adminUserId: 1,
  action: "user.comp.grant" as const,
  targetUserId: 9,
  reason: "tester",
};

describe("adminActionService.run", () => {
  it("never runs the action if the audit row can't be written", async () => {
    const { db } = fakeDb({ insertFails: true });
    (adminActionService as any).db = db;
    const fn = jest.fn(async () => ({ ok: true }));
    await expect(adminActionService.run(ctx, fn)).rejects.toThrow("insert failed");
    expect(fn).not.toHaveBeenCalled();
  });

  it("closes the row as succeeded with the action's result", async () => {
    const { db, updates } = fakeDb();
    (adminActionService as any).db = db;
    const result = await adminActionService.run(ctx, async () => ({ emailed: true }));
    expect(result).toEqual({ emailed: true });
    expect(updates[0]).toMatchObject({ status: "succeeded", result: { emailed: true } });
    expect(updates[0].finishedAt).toBeInstanceOf(Date);
  });

  it("closes the row as failed and rethrows when the action throws", async () => {
    const { db, updates } = fakeDb();
    (adminActionService as any).db = db;
    await expect(
      adminActionService.run(ctx, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(updates[0]).toMatchObject({ status: "failed", error: "boom" });
  });
});

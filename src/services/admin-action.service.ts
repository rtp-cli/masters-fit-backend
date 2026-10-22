import { desc } from "drizzle-orm";
import { adminActionLog } from "@/models";
import type { AdminAction } from "@/constants/admin-roles";
import { logger } from "@/utils/logger";
import { BaseService } from "./base.service";

export interface AdminActionContext {
  adminUserId: number;
  action: AdminAction;
  targetUserId?: number | null;
  reason: string;
  params?: Record<string, unknown>;
  ipAddress?: string;
}

class AdminActionService extends BaseService {
  /**
   * The one way an admin-console action changes state.
   *
   * 1. Writes a `started` row to admin_action_log. If that write fails, this
   *    throws and `fn` never runs — no unrecorded actions.
   * 2. Runs `fn`.
   * 3. Closes the row out as `succeeded` (with fn's result) or `failed` (with
   *    the error), then returns / rethrows.
   *
   * A failure in step 3 is logged, not thrown: the action has already happened
   * and the `started` row records that it was attempted.
   */
  async run<T extends Record<string, unknown>>(
    ctx: AdminActionContext,
    fn: () => Promise<T>
  ): Promise<T> {
    const [row] = await this.db
      .insert(adminActionLog)
      .values({
        adminUserId: ctx.adminUserId,
        action: ctx.action,
        targetUserId: ctx.targetUserId ?? null,
        reason: ctx.reason,
        params: ctx.params ?? null,
        status: "started",
        ipAddress: ctx.ipAddress ?? null,
      })
      .returning({ id: adminActionLog.id });

    try {
      const result = await fn();
      await this.finish(row.id, { status: "succeeded", result });
      return result;
    } catch (error) {
      await this.finish(row.id, {
        status: "failed",
        error: (error as Error)?.message ?? String(error),
      });
      throw error;
    }
  }

  private async finish(
    id: number,
    outcome:
      | { status: "succeeded"; result: Record<string, unknown> }
      | { status: "failed"; error: string }
  ): Promise<void> {
    try {
      await this.db
        .update(adminActionLog)
        .set({ ...outcome, finishedAt: new Date() })
        .where(this.eq(adminActionLog.id, id));
    } catch (error) {
      logger.error("Failed to close out admin action log row", error as Error, {
        operation: "adminAction.finish",
        metadata: { actionLogId: id, status: outcome.status },
      });
    }
  }

  /** Most recent actions first, for the console's activity view. */
  async list(limit = 50) {
    return this.db
      .select()
      .from(adminActionLog)
      .orderBy(desc(adminActionLog.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }
}

export const adminActionService = new AdminActionService();

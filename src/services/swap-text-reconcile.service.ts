import { and, eq, inArray, TransactionRollbackError } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import { aiProviderService } from "@/services/ai-provider.service";
import { AIProvider } from "@/constants/ai-providers";
import { DEFAULT_FANOUT_MODEL } from "@/utils/model-canary";
import { runWithAbortTimeout } from "@/utils/timeout.utils";
import { logger } from "@/utils/logger";
import { planDays, workoutBlocks, planDayExercises } from "@/models/workout.schema";
import {
  SwapProse,
  replaceInProse,
  proseMentionsMovement,
  acceptRewrite,
  proseChanged,
  buildSwapRewriteUserMessage,
  SWAP_REWRITE_SYSTEM_PROMPT,
  SWAP_REWRITE_SCHEMA,
} from "@/utils/swap-text-reconcile";

const REWRITE_TIMEOUT_MS = 20_000;

export interface SwapTextContext {
  planDayId: number;
  workoutBlockId: number;
  oldExerciseId: number;
  oldExerciseName: string;
  newExerciseName: string;
}

/**
 * Keeps the day + block prose in step with a manual exercise swap. See
 * utils/swap-text-reconcile.ts for the why; this is the DB + LLM wiring.
 */
export class SwapTextReconcileService extends BaseService {
  /**
   * Pass 1 (awaited by the swap) then pass 2 (fire-and-forget). Never throws:
   * stale prose is cosmetic, a failed swap is not.
   */
  async reconcileAfterSwap(ctx: SwapTextContext): Promise<void> {
    let afterPass1: { prose: SwapProse; stampedAt: Date } | null = null;
    try {
      afterPass1 = await this.applyNameReplacement(ctx);
    } catch (error) {
      logger.warn("Swap prose: name replacement failed", { ...ctx, error });
      return;
    }
    if (!afterPass1) return;

    const { prose, stampedAt } = afterPass1;
    if (!proseMentionsMovement(prose, ctx.oldExerciseName, ctx.newExerciseName)) return;

    void this.applyLlmRewrite(ctx, prose, stampedAt).catch((error) => {
      logger.warn("Swap prose: LLM rewrite failed; keeping name replacement", { ...ctx, error });
    });
  }

  /**
   * Returns null when nothing should be reconciled — the old exercise is still
   * elsewhere in the day (swapping only the warm-up row leaves squat prose
   * accurate), or the rows are gone. Otherwise writes the name replacement and
   * returns the resulting prose plus the updatedAt it stamped, which pass 2
   * uses to avoid overwriting a newer edit.
   */
  async applyNameReplacement(
    ctx: SwapTextContext
  ): Promise<{ prose: SwapProse; stampedAt: Date } | null> {
    if (await this.oldExerciseStillInDay(ctx)) return null;

    const prose = await this.readProse(ctx);
    if (!prose) return null;

    const replaced = replaceInProse(prose, ctx.oldExerciseName, ctx.newExerciseName);
    const stampedAt = new Date();
    await this.writeProse(ctx, replaced, stampedAt);
    return { prose: replaced, stampedAt };
  }

  async applyLlmRewrite(ctx: SwapTextContext, prose: SwapProse, stampedAt: Date): Promise<void> {
    const llm = aiProviderService
      .createLLMInstance(AIProvider.ANTHROPIC, DEFAULT_FANOUT_MODEL)
      .withStructuredOutput(SWAP_REWRITE_SCHEMA as any, { name: "swap_rewrite" });

    const proposed = (await runWithAbortTimeout(
      (signal) =>
        llm.invoke(
          [
            { role: "system", content: SWAP_REWRITE_SYSTEM_PROMPT },
            {
              role: "user",
              content: buildSwapRewriteUserMessage(prose, ctx.oldExerciseName, ctx.newExerciseName),
            },
          ],
          { signal }
        ),
      undefined,
      REWRITE_TIMEOUT_MS,
      "swap prose rewrite"
    )) as Partial<Record<keyof SwapProse, unknown>>;

    const accepted = acceptRewrite(prose, proposed, ctx.oldExerciseName);
    if (!proseChanged(prose, accepted)) return;

    // Only land if nothing touched these rows since pass 1 (another swap, a
    // regeneration) — a late rewrite of stale text would undo that change.
    const written = await this.writeProse(ctx, accepted, new Date(), stampedAt);
    logger.info("Swap prose: LLM rewrite applied", { ...ctx, written });
  }

  private async oldExerciseStillInDay(ctx: SwapTextContext): Promise<boolean> {
    const blocks = await this.db
      .select({ id: workoutBlocks.id })
      .from(workoutBlocks)
      .where(eq(workoutBlocks.planDayId, ctx.planDayId));
    if (blocks.length === 0) return false;
    const [still] = await this.db
      .select({ id: planDayExercises.id })
      .from(planDayExercises)
      .where(
        and(
          inArray(planDayExercises.workoutBlockId, blocks.map((b) => b.id)),
          eq(planDayExercises.exerciseId, ctx.oldExerciseId)
        )
      )
      .limit(1);
    return !!still;
  }

  private async readProse(ctx: SwapTextContext): Promise<SwapProse | null> {
    const day = await this.db.query.planDays.findFirst({
      where: eq(planDays.id, ctx.planDayId),
    });
    const block = await this.db.query.workoutBlocks.findFirst({
      where: eq(workoutBlocks.id, ctx.workoutBlockId),
    });
    if (!day || !block) return null;
    return {
      dayName: day.name,
      dayDescription: day.description,
      dayInstructions: day.instructions,
      blockName: block.blockName,
      blockInstructions: block.instructions,
    };
  }

  /**
   * Writes both rows in one transaction. With `ifUnchangedSince`, each update
   * only applies while the row's updatedAt still equals that stamp; returns
   * whether both rows were written.
   */
  private async writeProse(
    ctx: SwapTextContext,
    prose: SwapProse,
    stampAt: Date,
    ifUnchangedSince?: Date
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const dayWhere = ifUnchangedSince
        ? and(eq(planDays.id, ctx.planDayId), eq(planDays.updatedAt, ifUnchangedSince))
        : eq(planDays.id, ctx.planDayId);
      const blockWhere = ifUnchangedSince
        ? and(eq(workoutBlocks.id, ctx.workoutBlockId), eq(workoutBlocks.updatedAt, ifUnchangedSince))
        : eq(workoutBlocks.id, ctx.workoutBlockId);

      const dayRows = await tx
        .update(planDays)
        .set({
          name: prose.dayName,
          description: prose.dayDescription,
          instructions: prose.dayInstructions,
          updatedAt: stampAt,
        })
        .where(dayWhere)
        .returning({ id: planDays.id });
      const blockRows = await tx
        .update(workoutBlocks)
        .set({
          blockName: prose.blockName,
          instructions: prose.blockInstructions,
          updatedAt: stampAt,
        })
        .where(blockWhere)
        .returning({ id: workoutBlocks.id });

      const both = dayRows.length === 1 && blockRows.length === 1;
      if (ifUnchangedSince && !both) {
        // One row moved on under us; roll back so the pair stays consistent.
        tx.rollback();
      }
      return both;
    }).catch((error: unknown) => {
      if (error instanceof TransactionRollbackError) {
        return false;
      }
      throw error;
    });
  }
}

export const swapTextReconcileService = new SwapTextReconcileService();

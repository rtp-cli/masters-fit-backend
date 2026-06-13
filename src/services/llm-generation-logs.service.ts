import { and, avg, count, gte, lte, sql, sum } from "drizzle-orm";
import { llmGenerationLogs, InsertLlmGenerationLog } from "@/models";
import { BaseService } from "./base.service";
import { logger } from "@/utils/logger";

export interface LlmMetricsReport {
  rows: {
    operation: string;
    provider: string;
    model: string;
    callCount: number;
    avgDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    cacheHitPct: number;
  }[];
  periodStart: string | null;
  periodEnd: string | null;
}

export class LlmGenerationLogsService extends BaseService {
  async insert(data: InsertLlmGenerationLog): Promise<void> {
    try {
      await this.insertWithRetry(
        () => this.db.insert(llmGenerationLogs).values(data),
        "insertLlmGenerationLog",
        data.userId
      );
    } catch (error) {
      // Non-fatal — never let a metrics write block the caller
      logger.error("Failed to persist LLM generation log", error as Error, {
        operation: data.operation,
        userId: data.userId,
      });
    }
  }

  async getReport(options: {
    startDate?: string;
    endDate?: string;
  } = {}): Promise<LlmMetricsReport> {
    const { startDate, endDate } = options;

    const conditions = [];
    if (startDate) conditions.push(gte(llmGenerationLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(llmGenerationLogs.createdAt, new Date(endDate)));
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.selectWithRetry(
      () =>
        this.db
          .select({
            operation: llmGenerationLogs.operation,
            provider: llmGenerationLogs.provider,
            model: llmGenerationLogs.model,
            callCount: count(),
            avgDurationMs: avg(llmGenerationLogs.llmDurationMs),
            p50DurationMs: sql<number>`percentile_cont(0.5) within group (order by ${llmGenerationLogs.llmDurationMs})`,
            p95DurationMs: sql<number>`percentile_cont(0.95) within group (order by ${llmGenerationLogs.llmDurationMs})`,
            totalInputTokens: sum(llmGenerationLogs.inputTokens),
            totalOutputTokens: sum(llmGenerationLogs.outputTokens),
            totalCacheReadTokens: sum(llmGenerationLogs.cacheReadInputTokens),
            cacheHitPct: sql<number>`
              round(
                sum(${llmGenerationLogs.cacheReadInputTokens})::numeric
                / nullif(sum(${llmGenerationLogs.inputTokens}), 0) * 100,
                1
              )`,
          })
          .from(llmGenerationLogs)
          .where(where)
          .groupBy(
            llmGenerationLogs.operation,
            llmGenerationLogs.provider,
            llmGenerationLogs.model
          )
          .orderBy(
            llmGenerationLogs.operation,
            llmGenerationLogs.provider,
            llmGenerationLogs.model
          ),
      "getLlmMetricsReport"
    );

    return {
      rows: rows.map((r) => ({
        operation: r.operation,
        provider: r.provider,
        model: r.model,
        callCount: Number(r.callCount),
        avgDurationMs: Math.round(Number(r.avgDurationMs ?? 0)),
        p50DurationMs: Math.round(Number(r.p50DurationMs ?? 0)),
        p95DurationMs: Math.round(Number(r.p95DurationMs ?? 0)),
        totalInputTokens: Number(r.totalInputTokens ?? 0),
        totalOutputTokens: Number(r.totalOutputTokens ?? 0),
        totalCacheReadTokens: Number(r.totalCacheReadTokens ?? 0),
        cacheHitPct: Number(r.cacheHitPct ?? 0),
      })),
      periodStart: startDate ?? null,
      periodEnd: endDate ?? null,
    };
  }
}

export const llmGenerationLogsService = new LlmGenerationLogsService();

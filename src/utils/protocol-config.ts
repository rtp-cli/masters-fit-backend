import { z } from "zod";

/**
 * Typed protocol details for a workout block that the scalar columns
 * (rounds, timeCapMinutes) cannot express (gap-analysis Phase 4). Stored
 * as workout_blocks.protocol_config jsonb, ALWAYS validated through
 * protocolConfigSchema before persistence — never trust raw LLM output
 * into a jsonb column.
 *
 * Essential behavior must not depend on this being present: every block
 * renders and logs correctly with protocolConfig = null. It enriches:
 *  - repScheme: per-round rep targets, e.g. [21, 15, 9] for a descending
 *    ladder / classic couplet. When present, rounds should equal its
 *    length (normalization enforces this).
 *  - workSeconds/restSeconds: interval blocks ("30s on / 15s off",
 *    tabata's 20/10) as data instead of instruction prose.
 *  - intervalSeconds: EMOM-family slot length (60 = classic EMOM,
 *    90 = E90, 120 = E2MOM).
 */
export const protocolConfigSchema = z
  .object({
    repScheme: z.array(z.number().int().min(1).max(200)).min(2).max(12).optional(),
    workSeconds: z.number().int().min(5).max(3600).optional(),
    restSeconds: z.number().int().min(0).max(3600).optional(),
    intervalSeconds: z.number().int().min(10).max(600).optional(),
  })
  .strip();

export type ProtocolConfig = z.infer<typeof protocolConfigSchema>;

/**
 * Coerce whatever the LLM emitted into a valid ProtocolConfig or null.
 * Invalid shapes drop to null (the block still works without it);
 * an empty object also drops to null so we never store `{}`.
 */
export function normalizeProtocolConfig(raw: unknown): ProtocolConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const result = protocolConfigSchema.safeParse(raw);
  if (!result.success) return null;
  return Object.keys(result.data).length > 0 ? result.data : null;
}

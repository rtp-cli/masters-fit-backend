/**
 * Scoring type for a workout block — how the block is SCORED, independent
 * of how it is STRUCTURED (gap-analysis Phase 2). Stored on
 * workout_blocks.scoring_type; nullable, so consumers must fall back to
 * deriveScoringType(blockType) for rows created before the column existed.
 */
export const SCORING_TYPES = [
  "completion", // done / not done (warmups, mobility, flows)
  "rounds_reps", // AMRAP-style: rounds completed (+ partial reps)
  "time", // for_time: elapsed time to finish
  "reps", // total rep count (tabata)
  "load", // weight x reps (traditional strength)
  "quality", // subjective (not yet surfaced)
  "none",
] as const;

export type ScoringType = (typeof SCORING_TYPES)[number];

/**
 * Default scoring for each generated block type. These are sensible
 * defaults, not invariants — the column exists so a block can eventually
 * override (e.g. a completion-only circuit).
 */
export function deriveScoringType(blockType?: string | null): ScoringType {
  switch (blockType) {
    case "amrap":
    case "emom":
    case "circuit":
      return "rounds_reps";
    case "for_time":
      return "time";
    case "tabata":
      return "reps";
    case "warmup":
    case "cooldown":
    case "flow":
      return "completion";
    case "traditional":
    case "superset":
    default:
      // Unknown types render as traditional set-by-set in the app
      return "load";
  }
}

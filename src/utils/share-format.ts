import type { ShareSnapshotSet } from "@/models/share.schema";

// ---------------------------------------------------------------------------
// Row + block formatting. These run at share time and the result is frozen into
// the snapshot, so the card and the landing page can never disagree about how
// the same set reads.
// ---------------------------------------------------------------------------

export const WARMUP_COOLDOWN = /warm|cool|mobility|stretch|activation|prehab/i;

/** Blocks whose result is a block-level score, not per-exercise sets. */
export const SCORED_BLOCK_TYPES = new Set(["amrap", "emom", "for_time", "tabata"]);

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  traditional: "Strength",
  circuit: "Circuit",
  amrap: "AMRAP",
  emom: "EMOM",
  for_time: "For time",
  tabata: "Tabata",
  flow: "Flow",
};

/** 45 -> "45", 42.5 -> "42.5". Trailing ".00" from the numeric column is noise. */
function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

function range(values: number[]): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? trimNumber(lo) : `${trimNumber(lo)}-${trimNumber(hi)}`;
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/**
 * Collapse a list of logged sets into one line, plus an optional qualifier.
 *
 * Never prints "0 lb": a bodyweight movement has no load, and saying it weighed
 * nothing reads as a bug. Never invents reps either — sets logged with a weight
 * but no rep count say so, because that gap is real (nobody uses the explicit
 * skip flag, so a missing value is genuinely unknown, not a zero).
 */
export function summarizeSets(
  sets: ShareSnapshotSet[],
  rounds: number
): { summary: string; note: string | null } {
  if (sets.length === 0) return { summary: "Not logged", note: null };

  const countLabel = rounds > 1 ? `${rounds} rounds` : `${sets.length} sets`;

  const distances = sets.map((s) => s.distanceM).filter((d): d is number => !!d);
  if (distances.length === sets.length) {
    return { summary: rounds > 1 ? `${rounds} rounds x ${range(distances)} m` : `${range(distances)} m`, note: null };
  }

  const durations = sets.map((s) => s.durationSeconds).filter((d): d is number => !!d);
  if (durations.length === sets.length) {
    const uniq = [...new Set(durations)];
    const held = uniq.length === 1 ? formatSeconds(uniq[0]) : `${range(durations)}s`;
    return { summary: rounds > 1 ? `${rounds} rounds x ${held}` : `${sets.length} x ${held}`, note: null };
  }

  // A load of 0 is how bodyweight work is stored; treat it as "no load".
  const weights = sets.map((s) => s.weight).filter((w): w is number => w != null && w > 0);
  const loadPart = weights.length
    ? ` @ ${range(weights)} lb`
    : "";
  const note = weights.length ? null : "Bodyweight";

  const reps = sets.map((s) => s.reps).filter((r): r is number => r != null && r > 0);
  if (reps.length !== sets.length) {
    // Weight without reps — say so rather than printing a fabricated rep count.
    return { summary: `${countLabel}${loadPart}`, note: "Reps not logged" };
  }

  const repPart = range(reps);
  return {
    summary:
      rounds > 1
        ? `${rounds} rounds x ${repPart}${loadPart}`
        : `${sets.length} x ${repPart}${loadPart}`,
    note,
  };
}

/** The prescription line for a `planned` share, which has nothing logged yet. */
export function summarizePrescription(e: {
  sets: number | null;
  reps: number | null;
  repsMin: number | null;
  repsMax: number | null;
  distanceM: number | null;
  duration: number | null;
}): string {
  if (e.distanceM) return `${e.distanceM} m`;
  const setPart = e.sets ?? 1;
  if (e.duration) return `${setPart} x ${formatSeconds(e.duration)}`;
  const reps =
    e.repsMin && e.repsMax ? `${e.repsMin}-${e.repsMax}` : e.reps != null ? String(e.reps) : null;
  return reps ? `${setPart} x ${reps}` : `${setPart} sets`;
}

export function blockLabel(
  type: string | null,
  rounds: number | null,
  minutes: number | null,
  timeCap: number | null,
  score: string | null
): string {
  const parts: string[] = [BLOCK_TYPE_LABELS[type || ""] || "Strength"];
  if (rounds && rounds > 1) parts.push(`${rounds} rounds`);
  if (timeCap) parts.push(`${timeCap} min cap`);
  else if (minutes) parts.push(`${minutes} min`);
  if (score) parts.push(`scored ${score}`);
  return parts.join(" · ");
}

/** A human score for a scored block, or null when block_logs holds nothing. */
export function blockScore(log?: {
  score: string | null;
  roundsCompleted: number | null;
  totalReps: number | null;
  actualTimeMinutes: number | null;
}): string | null {
  if (!log) return null;
  if (log.score) return log.score;
  if (log.roundsCompleted != null) {
    return log.totalReps
      ? `${log.roundsCompleted} rounds + ${log.totalReps} reps`
      : `${log.roundsCompleted} rounds`;
  }
  if (log.actualTimeMinutes != null) return `${log.actualTimeMinutes} min`;
  return null;
}

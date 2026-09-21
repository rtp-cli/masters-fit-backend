import { and, eq, gt, gte } from "drizzle-orm";
import {
  exerciseExclusions,
  exercises,
  planDays,
  workouts,
  type Exercise,
  type ExerciseExclusion,
  type ExerciseExclusionReason,
  type InsertProfile,
} from "@/models";
import { BaseService } from "./base.service";
import { logger } from "@/utils/logger";
import { resolveTodayString } from "@/utils/date.utils";
import { filterExercisesByLimitations } from "@/utils/limitation-validation";
import { filterExercisesByFitnessLevel } from "@/utils/fitness-level-validation";
import { filterExercisesForWalkingModality } from "@/utils/walking-modality";
import { profiles } from "@/models/profile.schema";

// One catalog entry as ranked for a replacement slot. Everything the frontend
// needs to assemble the templated sentence and the covered/dashed muscle chips
// comes from real columns — nothing is asserted that the schema doesn't know.
export interface ReplacementCandidate {
  id: number;
  name: string;
  /** Catalog description, so a ranked list can render the same row as search. */
  description: string | null;
  muscleGroups: string[];
  equipment: string[] | null;
  difficulty: string | null;
  hasDemo: boolean | null;
  /** Count of the ORIGINAL's muscle groups this candidate also trains. */
  overlapCount: number;
}

// A scheduled exercise that overlaps the excluded one on muscle group — the
// 1d "anything else that bothers your {muscle}?" list.
export interface RelatedScheduledExercise {
  exerciseId: number;
  name: string;
  muscleGroups: string[];
  /** Weekday of the earliest upcoming day it appears, e.g. "Tuesday". */
  dayName: string;
}

interface ExclusionListEntry {
  exerciseId: number;
  name: string;
  muscleGroups: string[];
  reason: ExerciseExclusionReason;
  createdAt: Date;
}

// low < moderate < high. Null difficulty is treated as "unknown" and never
// penalized (distance 0), so a missing label can't push a good match down.
const DIFFICULTY_RANK: Record<string, number> = {
  low: 0,
  moderate: 1,
  high: 2,
};

function difficultyDistance(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  if (!a || !b) return 0;
  const ra = DIFFICULTY_RANK[a.toLowerCase()];
  const rb = DIFFICULTY_RANK[b.toLowerCase()];
  if (ra === undefined || rb === undefined) return 0;
  return Math.abs(ra - rb);
}

// Weekday name for a YYYY-MM-DD plan-day string. Dates are stored
// timezone-independent, so parse at local midnight and read the weekday of that
// calendar date. Never a count — the design names days.
function weekdayName(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

export class ExerciseExclusionService extends BaseService {
  /**
   * The user's excluded exercises, joined to catalog names. Flat and ordered so
   * the client can group by reason (Settings → Excluded exercises).
   */
  async listExclusions(userId: number): Promise<ExclusionListEntry[]> {
    const rows = await this.db
      .select({
        exerciseId: exerciseExclusions.exerciseId,
        name: exercises.name,
        muscleGroups: exercises.muscleGroups,
        reason: exerciseExclusions.reason,
        createdAt: exerciseExclusions.createdAt,
      })
      .from(exerciseExclusions)
      .innerJoin(exercises, eq(exercises.id, exerciseExclusions.exerciseId))
      .where(eq(exerciseExclusions.userId, userId))
      .orderBy(exerciseExclusions.reason, exerciseExclusions.createdAt);

    return rows as ExclusionListEntry[];
  }

  /**
   * Persist one or more exclusions (the originating exercise plus any the user
   * ticked in the 1d pain branch), optionally add a limitation to the profile
   * (a separate explicit opt-in — never inferred), then sweep the exclusions
   * forward across future plan days. Returns the day names touched so the caller
   * can confirm without ever showing a count.
   */
  async addExclusions(
    userId: number,
    items: { exerciseId: number; reason: ExerciseExclusionReason }[],
    addLimitation?: string | null
  ): Promise<{ sweptDayNames: string[] }> {
    if (items.length === 0) return { sweptDayNames: [] };

    // Idempotent: re-excluding an exercise no-ops on the unique (user, exercise)
    // index rather than erroring.
    await this.db
      .insert(exerciseExclusions)
      .values(
        items.map((it) => ({
          userId,
          exerciseId: it.exerciseId,
          reason: it.reason,
        }))
      )
      .onConflictDoNothing();

    if (addLimitation) {
      await this.appendLimitation(userId, addLimitation);
    }

    // Each excluded exercise sweeps its own future occurrences; collect the
    // union of day names for the confirmation.
    const swept = new Set<string>();
    for (const it of items) {
      const days = await this.sweepForward(userId, it.exerciseId);
      days.forEach((d) => swept.add(d));
    }

    return { sweptDayNames: [...swept] };
  }

  async removeExclusion(userId: number, exerciseId: number): Promise<void> {
    await this.db
      .delete(exerciseExclusions)
      .where(
        and(
          eq(exerciseExclusions.userId, userId),
          eq(exerciseExclusions.exerciseId, exerciseId)
        )
      );
  }

  /**
   * Ranked replacements for a slot. Retrieval is the existing filtered search
   * (owned-equipment filter + query-time exclusion of the original and all the
   * user's exclusions) — equipment is a FILTER, not a tiebreak. Survivors are
   * then ordered: muscle-overlap count desc → difficulty distance asc → hasDemo
   * first. No model call; pure ranking over real columns.
   *
   * [#109] Then the three Tier-1 safety guardrails, which this path was
   * missing entirely. Measured 2026-09-21: a BEGINNER with ARTHRITIS whose only
   * style is Walking & Movement, tapping Replace on their walk, was offered
   * "Driveway Hill Run", "Box Jump", "Bodyweight Jumping Jacks" and "Burpees".
   * `Burpees` and `Box Jump` are listed by name in BEGINNER_EXCLUDED_MOVEMENTS
   * — the app was offering, by name, the movements LR-073 exists to withhold.
   *
   * The hole was that `difficultyDistance` is a TIEBREAK, not a filter: it
   * prefers a similar difficulty but excludes nothing, so nothing stopped a
   * `high` movement ranking into the list. All three guardrails lived only in
   * getSharedGenerationCatalog, and each was written after a real incident
   * (LR-013 contraindications, LR-073 beginners handed burpees, LR-085 walkers
   * handed in-place cardio) — every one of which was reachable again here.
   *
   * THE LINE THIS DRAWS, deliberately:
   *   - The app's SUGGESTIONS respect the guardrails. Seeding the replace list
   *     is the app choosing what to put in front of someone, which is the same
   *     act as the generator choosing, so it earns the same constraints.
   *   - The user's own SEARCH does not. searchExercisesWithFilters stays
   *     unfiltered, so a deliberate, typed-out search still finds any movement.
   *     That escape hatch is the whole reason #102 needs no new plumbing.
   *
   * A profile that cannot be loaded leaves the pool unconstrained rather than
   * assumed fragile — the same stance fitness-level-validation.ts already
   * documents for a null fitnessLevel, and it keeps a data hiccup from emptying
   * the replace list.
   */
  /**
   * [#109] The three Tier-1 guardrails from getSharedGenerationCatalog, applied
   * to a candidate pool. Kept private and profile-loading so callers cannot
   * forget it — the bug was that this path simply never ran them.
   */
  private async applySafetyGuardrails(
    userId: number,
    pool: Exercise[]
  ): Promise<Exercise[]> {
    const profile = await this.db.query.profiles.findFirst({
      where: eq(profiles.userId, userId),
    });
    if (!profile) {
      logger.warn("No profile for replacement guardrails; leaving pool unconstrained", {
        userId,
        operation: "rankReplacements",
      });
      return pool;
    }

    const withinLimitations = filterExercisesByLimitations(pool, profile);
    const withinLevel = filterExercisesByFitnessLevel(withinLimitations, profile);
    const allowed = filterExercisesForWalkingModality(withinLevel, profile);

    if (allowed.length !== pool.length) {
      logger.info("Replacement candidates filtered by safety guardrails", {
        userId,
        operation: "rankReplacements",
        metadata: {
          poolCount: pool.length,
          excludedByLimitations: pool.length - withinLimitations.length,
          excludedByFitnessLevel: withinLimitations.length - withinLevel.length,
          excludedByWalkingModality: withinLevel.length - allowed.length,
        },
      });
    }
    return allowed;
  }

  async rankReplacements(
    userId: number,
    originalExerciseId: number,
    limit = 3
  ): Promise<ReplacementCandidate[]> {
    const original = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, originalExerciseId),
    });
    if (!original) return [];

    // Lazy import avoids a service-init import cycle (search ↔ exclusion).
    const { searchService } = await import("./search.service");
    const { exercises: pool } = await searchService.searchExercisesWithFilters(
      userId,
      {
        muscleGroups: original.muscleGroups,
        excludeId: originalExerciseId,
        userEquipmentOnly: true,
        // Wide net — ranking trims to `limit`. Overlap search already narrows
        // to muscle-relevant rows, so this is not the whole catalog.
        limit: 200,
      }
    );

    const originalMuscles = new Set(
      (original.muscleGroups ?? []).map((m) => m.toLowerCase())
    );

    // [#109] Same guardrails, same order, as the generation catalog.
    const safePool = await this.applySafetyGuardrails(
      userId,
      pool as Exercise[]
    );

    const ranked = safePool
      .map((c) => ({
        candidate: c,
        overlapCount: (c.muscleGroups ?? []).filter((m) =>
          originalMuscles.has(m.toLowerCase())
        ).length,
        diffDist: difficultyDistance(c.difficulty, original.difficulty),
      }))
      .sort(
        (a, b) =>
          b.overlapCount - a.overlapCount ||
          a.diffDist - b.diffDist ||
          Number(Boolean(b.candidate.hasDemo)) -
            Number(Boolean(a.candidate.hasDemo)) ||
          a.candidate.name.localeCompare(b.candidate.name)
      );

    return ranked.slice(0, limit).map((r) => ({
      id: r.candidate.id,
      name: r.candidate.name,
      description: r.candidate.description ?? null,
      muscleGroups: r.candidate.muscleGroups ?? [],
      equipment: r.candidate.equipment ?? null,
      difficulty: r.candidate.difficulty ?? null,
      hasDemo: r.candidate.hasDemo ?? null,
      overlapCount: r.overlapCount,
    }));
  }

  /**
   * Future incomplete plan days in the active plan that still contain the given
   * exercise. Powers the 1c sweep disclosure ("It's also in Saturday's
   * workout") — day names only, never a count, resolved before 1c renders.
   */
  async getSweepPreview(
    userId: number,
    exerciseId: number
  ): Promise<{ dayNames: string[] }> {
    const days = await this.getFutureDaysWithExercise(userId, exerciseId);
    // Preserve chronological order (query is date-asc); dedupe defensively.
    const names: string[] = [];
    for (const d of days) {
      const name = weekdayName(d.date);
      if (!names.includes(name)) names.push(name);
    }
    return { dayNames: names };
  }

  /**
   * Other exercises already scheduled in the user's upcoming plan that overlap
   * the excluded one on muscle group — the 1d list. A fact assembled from
   * muscle_groups + plan membership, both of which exist today. Deduped by
   * exercise, labelled with the earliest upcoming day it appears.
   */
  async getRelatedScheduled(
    userId: number,
    exerciseId: number
  ): Promise<RelatedScheduledExercise[]> {
    const original = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, exerciseId),
    });
    if (!original) return [];
    const originalMuscles = new Set(
      (original.muscleGroups ?? []).map((m) => m.toLowerCase())
    );
    if (originalMuscles.size === 0) return [];

    // Upcoming = today + future, incomplete. (Completed days are history and
    // must not drive a future exclusion.)
    const days = await this.getUpcomingDays(userId);

    const seen = new Set<number>();
    const result: RelatedScheduledExercise[] = [];
    for (const day of days) {
      for (const block of day.blocks) {
        for (const bex of block.exercises) {
          const ex = bex.exercise;
          if (!ex || ex.id === exerciseId || seen.has(ex.id)) continue;
          const overlaps = (ex.muscleGroups ?? []).some((m: string) =>
            originalMuscles.has(m.toLowerCase())
          );
          if (!overlaps) continue;
          seen.add(ex.id);
          result.push({
            exerciseId: ex.id,
            name: ex.name,
            muscleGroups: ex.muscleGroups ?? [],
            dayName: weekdayName(day.date),
          });
        }
      }
    }
    return result;
  }

  /**
   * Swap the excluded exercise out of every FUTURE incomplete plan day, each
   * with its OWN top-ranked replacement (never blindly inheriting today's
   * pick). Never touches a completed or in-progress day. If no replacement
   * survives the filter for a day, the slot is emptied rather than left holding
   * a now-excluded exercise. Returns the weekday names actually touched.
   */
  async sweepForward(userId: number, exerciseId: number): Promise<string[]> {
    const days = await this.getFutureDaysWithExercise(userId, exerciseId);
    if (days.length === 0) return [];

    const { workoutService } = await import("./workout.service");
    const touched: string[] = [];

    for (const day of days) {
      // Rank per day so each slot gets its own pick. The exclusion row already
      // exists by now, so the excluded exercise can never be its own suggestion.
      const [pick] = await this.rankReplacements(userId, exerciseId, 1);
      for (const pdeId of day.planDayExerciseIds) {
        try {
          if (pick) {
            await workoutService.replaceExercise(pdeId, pick.id);
          } else {
            await workoutService.deletePlanDayExercise(pdeId);
          }
        } catch (error) {
          logger.error("Sweep-forward swap failed for a plan day exercise", error as Error, {
            operation: "sweepForward",
            metadata: { userId, exerciseId, planDayExerciseId: pdeId },
          });
        }
      }
      const name = weekdayName(day.date);
      if (!touched.includes(name)) touched.push(name);
    }
    return touched;
  }

  // ---- internal helpers ----

  private async appendLimitation(
    userId: number,
    limitation: string
  ): Promise<void> {
    const { profileService } = await import("./profile.service");
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) return;
    const current = (profile.limitations ?? []) as string[];
    if (current.includes(limitation)) return;
    await profileService.createOrUpdateProfile({
      userId,
      limitations: [...current, limitation],
    } as unknown as InsertProfile);
  }

  private async getActiveWorkoutId(userId: number): Promise<number | null> {
    const active = await this.db.query.workouts.findFirst({
      where: and(
        eq(workouts.userId, userId),
        eq(workouts.completed, false),
        eq(workouts.isActive, true)
      ),
    });
    return active?.id ?? null;
  }

  private async getUserToday(userId: number): Promise<string> {
    const { profileService } = await import("./profile.service");
    const profile = await profileService.getProfileByUserId(userId);
    return resolveTodayString(profile?.timezone ?? undefined);
  }

  /**
   * Future (date > today) incomplete days that contain the exercise, each with
   * the matching plan-day-exercise row ids so the sweep can target them.
   */
  private async getFutureDaysWithExercise(
    userId: number,
    exerciseId: number
  ): Promise<{ date: string; planDayExerciseIds: number[] }[]> {
    const workoutId = await this.getActiveWorkoutId(userId);
    if (!workoutId) return [];
    const today = await this.getUserToday(userId);

    const days = await this.db.query.planDays.findMany({
      where: and(
        eq(planDays.workoutId, workoutId),
        eq(planDays.isComplete, false),
        gt(planDays.date, today)
      ),
      orderBy: (pd, { asc }) => [asc(pd.date)],
      with: { blocks: { with: { exercises: true } } },
    });

    const result: { date: string; planDayExerciseIds: number[] }[] = [];
    for (const day of days as any[]) {
      const ids: number[] = [];
      for (const block of day.blocks) {
        for (const bex of block.exercises) {
          if (bex.exerciseId === exerciseId) ids.push(bex.id);
        }
      }
      if (ids.length > 0) result.push({ date: day.date, planDayExerciseIds: ids });
    }
    return result;
  }

  /**
   * Upcoming (date >= today) incomplete days with full exercise details, for
   * the 1d related-exercises list.
   */
  private async getUpcomingDays(userId: number): Promise<any[]> {
    const workoutId = await this.getActiveWorkoutId(userId);
    if (!workoutId) return [];
    const today = await this.getUserToday(userId);

    return (await this.db.query.planDays.findMany({
      where: and(
        eq(planDays.workoutId, workoutId),
        eq(planDays.isComplete, false),
        gte(planDays.date, today)
      ),
      orderBy: (pd, { asc }) => [asc(pd.date)],
      with: { blocks: { with: { exercises: { with: { exercise: true } } } } },
    })) as any[];
  }
}

export const exerciseExclusionService = new ExerciseExclusionService();

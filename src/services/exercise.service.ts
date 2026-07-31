import { Exercise, exercises, InsertExercise } from "@/models";
import { BaseService } from "./base.service";
import {
  eq,
  ilike,
  and,
  arrayOverlaps,
  inArray,
  or,
  isNull,
  sql,
} from "drizzle-orm";
import { logger } from "@/utils/logger";
import { checkDemoLink } from "@/utils/video-validation";
import { AvailableEquipment, IntensityLevels } from "@/constants";

// Interface for exercise metadata (minimal data for LLM)
export interface ExerciseMetadata {
  name: string;
  equipment: string[] | null;
  muscleGroups: string[];
  difficulty: string | null;
  /** Style tag (hiit/crossfit/strength/…) — present on the generation-catalog path. */
  tag?: string | null;
  /** Whether a demo video is attached — present on the generation-catalog path. */
  hasDemo?: boolean | null;
}

/**
 * Deterministic stratified selection for the generation catalog.
 *
 * The LLM's menu used to be `LIMIT 200` with no ORDER BY over ~1,690 rows —
 * an arbitrary slice that changed between generations and could omit whole
 * movement families (the majority experience: ~65% of users are
 * commercial_gym and get no equipment narrowing). This picks round-robin
 * across muscle-group buckets so every family is represented, and within a
 * bucket prefers the user's preferred styles, then exercises with demo
 * videos, then name — same inputs, same menu, every time.
 *
 * Pure and exported for tests.
 */
export function stratifyCatalog(
  pool: ExerciseMetadata[],
  options: { preferredStyles?: string[] | null; limit: number }
): ExerciseMetadata[] {
  // No small-pool shortcut: even when everything fits, the pool arrives in
  // arbitrary DB row order, and the menu must be deterministic regardless.
  const styles = new Set(
    (options.preferredStyles ?? []).map((s) => s.toLowerCase())
  );
  const styleMatch = (ex: ExerciseMetadata) =>
    ex.tag && styles.has(ex.tag.toLowerCase()) ? 1 : 0;

  // Bucket by first muscle group, normalized ("Lower back"/"lower_back" merge).
  const buckets = new Map<string, ExerciseMetadata[]>();
  for (const ex of pool) {
    const key = (ex.muscleGroups?.[0] ?? "general")
      .toLowerCase()
      .replace(/[\s_]+/g, " ")
      .trim();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(ex);
    else buckets.set(key, [ex]);
  }

  for (const bucket of buckets.values()) {
    bucket.sort(
      (a, b) =>
        styleMatch(b) - styleMatch(a) ||
        Number(b.hasDemo ?? false) - Number(a.hasDemo ?? false) ||
        a.name.localeCompare(b.name)
    );
  }

  // Round-robin across buckets (alphabetical bucket order for determinism)
  // until the limit is reached or the pool runs dry.
  const orderedBuckets = [...buckets.keys()].sort();
  const selected: ExerciseMetadata[] = [];
  let depth = 0;
  while (selected.length < options.limit) {
    let drewAny = false;
    for (const key of orderedBuckets) {
      const bucket = buckets.get(key)!;
      if (depth < bucket.length) {
        selected.push(bucket[depth]);
        drewAny = true;
        if (selected.length >= options.limit) break;
      }
    }
    if (!drewAny) break;
    depth++;
  }
  return selected;
}

// The real canonical enums (@/constants/profile) already exist and are even
// wired into a Zod schema (insertExerciseSchema) — that schema is just never
// actually called before insert, which is the real gap. muscle_groups has no
// canonical enum and is NOT clean enough to fake one tonight (wildly
// inconsistent casing/naming in real data today, e.g. "chest"/"Chest",
// "hip flexors"/"Hip Flexors"/"hip_flexors" — flagged for LR-035 catalog
// curation), so it only gets a structural (non-empty) check.
const KNOWN_DIFFICULTIES = new Set<string>(Object.values(IntensityLevels));
const KNOWN_EQUIPMENT = new Set<string>(Object.values(AvailableEquipment));

export class ExerciseService extends BaseService {
  /**
   * Validates exercise fields against known-good values before insert.
   * Returns a list of problems (empty = valid) rather than throwing, so
   * callers can decide whether to skip the exercise or log-and-continue.
   */
  validateExerciseData(data: InsertExercise): string[] {
    const problems: string[] = [];

    if (data.difficulty && !KNOWN_DIFFICULTIES.has(data.difficulty)) {
      problems.push(`unknown difficulty "${data.difficulty}"`);
    }

    for (const item of data.equipment ?? []) {
      if (!KNOWN_EQUIPMENT.has(item)) {
        problems.push(`unknown equipment "${item}"`);
      }
    }

    if (!data.muscleGroups || data.muscleGroups.length === 0) {
      problems.push("muscleGroups is empty");
    } else if (data.muscleGroups.some((g) => !g || !g.trim())) {
      problems.push("muscleGroups contains an empty value");
    } else if (data.muscleGroups.some((g) => g.includes(","))) {
      // Comma-packed values ("chest, triceps" as one element) silently defeat
      // arrayOverlaps — the muscle-overlap ranking and exclusion search both
      // rely on one muscle per array element. Prod is clean today (verified);
      // this seed-time assert keeps it that way so a future regression surfaces
      // here instead of as silently-missing search matches.
      problems.push("muscleGroups contains a comma-packed value");
    }

    return problems;
  }

  async createExercise(data: InsertExercise) {
    const result = await this.db
      .insert(exercises)
      .values([
        {
          name: data.name,
          muscleGroups: data.muscleGroups,
          instructions: Array.isArray(data.instructions)
            ? data.instructions.join("\n")
            : data.instructions,
          equipment: data.equipment,
          description: data.description,
          difficulty: data.difficulty,
          tag: data.tag,
          link: data.link,
          hasDemo: await checkDemoLink(data.link),
        },
      ])
      .returning();
    return result[0];
  }

  async createExerciseIfNotExists(data: InsertExercise) {
    // Reuse an existing row only when it's the SAME exercise: exact name, or
    // equal after stripping case/punctuation/whitespace ("Push-Ups" ==
    // "Push Ups"). The old check reused any substring match, so a proposed
    // "Deadlift" was treated as already existing because "Romanian Deadlift"
    // contained it — the workout then silently got the wrong variant.
    const existing =
      (await this.getExerciseByExactName(data.name)) ??
      (await this.getExerciseByNormalizedName(data.name));
    if (existing) {
      logger.debug(
        `Exercise "${data.name}" already exists with ID ${existing.id}, skipping creation`,
        {
          operation: "createExerciseIfNotExists",
          metadata: { exerciseName: data.name, existingId: existing.id },
        }
      );
      return existing;
    }

    // If not found, validate before creating. Log-and-allow rather than
    // reject-and-skip: skipping would require verifying every caller handles
    // a missing exercise gracefully (unverified tonight), whereas logging
    // still surfaces the data-quality signal without that risk.
    const problems = this.validateExerciseData(data);
    if (problems.length > 0) {
      logger.warn(`Exercise "${data.name}" has data-quality issues`, {
        operation: "createExerciseIfNotExists",
        metadata: { exerciseName: data.name, problems },
      });
    }

    // [LR-056] The check above is still a check-then-insert race under
    // concurrent fan-out day-generation: two calls introducing the same new
    // name could both pass the "not found" check above. createExerciseInsert
    // relies on the DB-level unique index on lower(name) as the real guard —
    // if a concurrent insert wins the race, this falls back to reading back
    // whichever row actually landed, instead of erroring or duplicating.
    const inserted = await this.createExerciseInsertIgnoringConflict(data);
    if (inserted) return inserted;

    const winner = await this.getExerciseByExactName(data.name);
    if (winner) {
      logger.debug(
        `Exercise "${data.name}" was created concurrently, using existing ID ${winner.id}`,
        {
          operation: "createExerciseIfNotExists",
          metadata: { exerciseName: data.name, existingId: winner.id },
        }
      );
      return winner;
    }
    // Conflict happened but the winning row is gone by the time we looked
    // (e.g. deleted between the two queries) — vanishingly unlikely, but
    // don't silently return undefined.
    throw new Error(
      `Exercise "${data.name}" conflicted on insert but could not be re-read`
    );
  }

  /**
   * Same insert as createExercise, but with a bare `.onConflictDoNothing()`
   * (no target) so it no-ops against idx_exercises_name_unique instead of
   * throwing. No target is needed since that's the only unique constraint on
   * this table — bare ON CONFLICT DO NOTHING applies to any of them. (An
   * earlier version tried a raw sql`` template to target `lower(name)`
   * explicitly, since Drizzle's typed onConflictDoNothing() only accepts real
   * columns — but sql`` silently mis-binds a plain JS array value as a
   * comma-spread list instead of a single Postgres array parameter, breaking
   * the muscle_groups column. Staying on the typed builder avoids that.)
   * Returns undefined (not an error) if another insert won the race.
   */
  private async createExerciseInsertIgnoringConflict(
    data: InsertExercise
  ): Promise<Exercise | undefined> {
    const result = await this.db
      .insert(exercises)
      .values([
        {
          name: data.name,
          muscleGroups: data.muscleGroups,
          instructions: Array.isArray(data.instructions)
            ? data.instructions.join("\n")
            : data.instructions,
          equipment: data.equipment,
          description: data.description,
          difficulty: data.difficulty,
          tag: data.tag,
          link: data.link,
          hasDemo: await checkDemoLink(data.link),
        },
      ])
      .onConflictDoNothing()
      .returning();
    return result[0];
  }

  private async getExerciseByExactName(name: string) {
    return await this.db.query.exercises.findFirst({
      where: sql`lower(${exercises.name}) = lower(${name})`,
    });
  }

  /**
   * Same-name-modulo-formatting match: case, punctuation, and whitespace
   * stripped on both sides ("Push-Ups" == "push ups"). Sequential scan, but
   * only runs on the rare new-exercise create path, never during persistence.
   */
  private async getExerciseByNormalizedName(name: string) {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalized) return undefined;
    return await this.db.query.exercises.findFirst({
      where: sql`regexp_replace(lower(${exercises.name}), '[^a-z0-9]', '', 'g') = ${normalized}`,
    });
  }

  async getExerciseById(id: number) {
    const result = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, id),
    });

    return result;
  }

  async getExercises(): Promise<Exercise[]> {
    const result = await this.db.query.exercises.findMany();
    return result;
  }

  async updateExercise(id: number, data: InsertExercise) {
    // Convert instructions array to string if needed
    const updateData = {
      ...data,
      instructions: Array.isArray(data.instructions)
        ? data.instructions.join("\n")
        : data.instructions,
      // Revalidate the demo verdict whenever the link is part of the update
      ...(data.link !== undefined
        ? { hasDemo: await checkDemoLink(data.link) }
        : {}),
    };

    const result = await this.db
      .update(exercises)
      .set(updateData)
      .where(eq(exercises.id, id))
      .returning();

    return result[0];
  }

  async deleteExercise(id: number) {
    await this.db.delete(exercises).where(eq(exercises.id, id));
  }

  /**
   * Resolve an LLM-chosen exercise name to a catalog row.
   *
   * Exact case-insensitive match first (hits idx_exercises_name_unique,
   * unambiguous). Only on a miss does it fall back to substring matching —
   * and then deterministically, preferring the SHORTEST containing name so
   * "Back Squat" resolves to "Back Squat"-like variants before
   * "Box Back Squat". The old findFirst with no ORDER BY returned whichever
   * row the planner produced first, silently swapping in wrong variants.
   * Every fuzzy substitution is logged so mismatches are visible in prod.
   */
  async getExerciseByName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return undefined;

    const exact = await this.getExerciseByExactName(trimmed);
    if (exact) return exact;

    const [fuzzy] = await this.db
      .select()
      .from(exercises)
      .where(ilike(exercises.name, `%${trimmed}%`))
      .orderBy(sql`length(${exercises.name}) asc`, exercises.name)
      .limit(1);

    if (fuzzy) {
      logger.warn("Exercise resolved by fuzzy fallback — name substituted", {
        operation: "getExerciseByName",
        metadata: { requested: trimmed, resolved: fuzzy.name, resolvedId: fuzzy.id },
      });
    }
    return fuzzy;
  }

  /**
   * Batch-resolve exercises by exact name (case-insensitive), in a single query.
   * [PERF-01] Replaces the per-name `getExerciseByName` fan-out during persistence,
   * which fired one `ILIKE '%name%'` query per exercise (~30-45 per weekly plan) —
   * and, because a leading-wildcard ILIKE cannot use the name index, each was a
   * sequential scan of the whole catalog. This matches `lower(name)` exactly, hitting
   * the `idx_exercises_name_unique` functional index. The LLM is instructed to use the
   * exact names from the provided catalog, so exact match is correct here.
   */
  async getExercisesByNames(names: string[]): Promise<Exercise[]> {
    const unique = Array.from(new Set(names.map((n) => n.trim().toLowerCase()))).filter(
      (n) => n.length > 0
    );
    if (unique.length === 0) return [];

    const result = await this.db
      .select()
      .from(exercises)
      .where(inArray(sql`lower(${exercises.name})`, unique));

    return result as Exercise[];
  }

  async updateExerciseLink(id: number, link: string | null) {
    const result = await this.db
      .update(exercises)
      .set({ link, hasDemo: await checkDemoLink(link) })
      .where(eq(exercises.id, id))
      .returning();

    return result[0];
  }

  async searchExercises(filters: {
    muscleGroups?: string[];
    equipment?: string[];
    difficulty?: string[];
    styles?: string[];
    limit?: number;
  }): Promise<ExerciseMetadata[]> {
    try {
      let query = this.db
        .select({
          name: exercises.name,
          equipment: exercises.equipment,
          muscleGroups: exercises.muscleGroups,
          difficulty: exercises.difficulty,
        })
        .from(exercises);

      const conditions = [];

      // Filter by muscle groups (if any muscle group overlaps)
      if (filters.muscleGroups && filters.muscleGroups.length > 0) {
        conditions.push(arrayOverlaps(exercises.muscleGroups, filters.muscleGroups));
      }

      // Filter by equipment with strict enforcement
      const equipmentCondition = this.buildEquipmentCondition(filters.equipment);
      if (equipmentCondition) {
        conditions.push(equipmentCondition);
      }

      // Filter by difficulty
      if (filters.difficulty && filters.difficulty.length > 0) {
        conditions.push(inArray(exercises.difficulty, filters.difficulty as any));
      }

      // Filter by styles (using tag field)
      if (filters.styles && filters.styles.length > 0) {
        conditions.push(inArray(exercises.tag, filters.styles));
      }

      // Apply all conditions
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      // Apply limit (default to 50)
      const limit = filters.limit || 50;
      const finalQuery = query.limit(limit);

      const result = await finalQuery;

      logger.info("Exercise search completed", {
        operation: "searchExercises",
        metadata: {
          filters,
          resultCount: result.length,
        }
      });

      return result as ExerciseMetadata[];
    } catch (error) {
      logger.error("Exercise search failed", error as Error, {
        operation: "searchExercises",
        metadata: { filters }
      });
      throw error;
    }
  }

  /**
   * Equipment predicate shared by searchExercises and the generation
   * catalog. Bodyweight-only requests match null/empty/"bodyweight"
   * equipment; specific equipment matches any overlap, plus bodyweight
   * exercises as always-available alternatives. Undefined = no filtering.
   */
  private buildEquipmentCondition(equipment?: string[]) {
    if (!equipment || equipment.length === 0) return undefined;

    const isBodyweightOnly =
      equipment.length === 1 &&
      (equipment[0].toLowerCase().includes("bodyweight") ||
        equipment[0].toLowerCase().includes("none"));

    if (isBodyweightOnly) {
      return or(
        isNull(exercises.equipment),
        eq(exercises.equipment, []),
        arrayOverlaps(exercises.equipment, ["bodyweight"])
      );
    }
    return or(
      arrayOverlaps(exercises.equipment, equipment as any),
      isNull(exercises.equipment),
      eq(exercises.equipment, [])
    );
  }

  /**
   * The exercise menu shown to the LLM during generation: the full
   * equipment-eligible pool (with tag + hasDemo so the stratifier can rank),
   * NOT truncated here — callers run the limitation filter first, then
   * stratifyCatalog, so banned exercises never consume catalog slots.
   */
  async getGenerationCatalogPool(equipment?: string[]): Promise<ExerciseMetadata[]> {
    let query = this.db
      .select({
        name: exercises.name,
        equipment: exercises.equipment,
        muscleGroups: exercises.muscleGroups,
        difficulty: exercises.difficulty,
        tag: exercises.tag,
        hasDemo: exercises.hasDemo,
      })
      .from(exercises);

    const condition = this.buildEquipmentCondition(equipment);
    if (condition) {
      query = query.where(condition) as any;
    }
    const result = await query;
    return result as ExerciseMetadata[];
  }
}

export const exerciseService = new ExerciseService();

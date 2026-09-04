import { and, asc, desc, eq } from "drizzle-orm";

import { BaseService } from "@/services/base.service";
import {
  trainingLocations,
  TrainingLocation,
} from "@/models/training-location.schema";
import { profiles } from "@/models/profile.schema";
import { planDays } from "@/models/workout.schema";
import {
  getEquipmentForEnvironment,
  WorkoutEnvironments,
} from "@/constants/profile";
import { createTimestamp } from "@/utils/date.utils";

// Cap is one primary + three saved secondaries (spec §2.1 / README). The DB
// enforces the single-primary invariant via a partial unique index; the total
// cap can't be a simple constraint, so it lives here.
export const MAX_SECONDARY_LOCATIONS = 3;
export const DEFAULT_PRIMARY_NAME = "My usual place";

export class LocationCapReachedError extends Error {
  constructor() {
    super(
      `You can save up to ${MAX_SECONDARY_LOCATIONS} other places. Remove one in Settings to save another.`
    );
    this.name = "LocationCapReachedError";
  }
}

export class LocationNotFoundError extends Error {
  constructor() {
    super("Location not found.");
    this.name = "LocationNotFoundError";
  }
}

export class CannotDeletePrimaryError extends Error {
  constructor() {
    super("You can't remove your usual place. Make another place primary first.");
    this.name = "CannotDeletePrimaryError";
  }
}

/**
 * Owns every write to `training_locations` and keeps the profile's
 * environment/equipment columns in sync as a dependent MIRROR. This is the
 * single writer: generation, the exercise-pool filter and the cache key keep
 * reading profile.* unchanged, but they are only ever written from here (via
 * `syncPrimaryFromProfile`, `makePrimary`, or an env/equipment edit to the
 * primary row) — never independently. That closes the dual-write bug class.
 */
export class TrainingLocationService extends BaseService {
  /**
   * Resolve the equipment set for an environment, matching profile.service's
   * long-standing rules exactly: commercial gym gets the full hardcoded list,
   * bodyweight is empty, a custom/home gym keeps the caller's selection.
   */
  resolveEquipment(
    environment: string,
    equipment?: string[] | null
  ): string[] {
    if (environment === WorkoutEnvironments.COMMERCIAL_GYM) {
      return getEquipmentForEnvironment(environment);
    }
    if (environment === WorkoutEnvironments.BODYWEIGHT_ONLY) {
      return [];
    }
    // HOME_GYM (custom): user-selected equipment.
    return equipment ?? [];
  }

  async getUserLocations(userId: number): Promise<TrainingLocation[]> {
    const query = () =>
      this.selectWithRetry(
        () =>
          this.db
            .select()
            .from(trainingLocations)
            .where(eq(trainingLocations.userId, userId))
            // Primary first, then oldest-created secondaries.
            .orderBy(
              desc(trainingLocations.isPrimary),
              asc(trainingLocations.createdAt)
            ),
        "getUserLocations",
        userId
      ) as Promise<TrainingLocation[]>;

    let rows = await query();
    // Self-heal the invariant: every user must have one primary. Users created
    // outside the onboarding write path (seeds, reseeded demo user, direct
    // inserts) never triggered the profile→primary sync, so lazily create the
    // primary from their profile here. One-time per user; idempotent afterward.
    if (!rows.some((r) => r.isPrimary)) {
      const created = await this.ensurePrimaryFromProfile(userId);
      if (created) rows = await query();
    }
    return rows;
  }

  /** Create the primary from the user's profile if one is missing. */
  private async ensurePrimaryFromProfile(userId: number): Promise<boolean> {
    const prof = await this.selectWithRetry(
      () =>
        this.db
          .select({
            environment: profiles.environment,
            equipment: profiles.equipment,
          })
          .from(profiles)
          .where(eq(profiles.userId, userId))
          .limit(1),
      "ensurePrimaryFromProfile:readProfile",
      userId
    );
    const p = (prof as { environment: string | null; equipment: string[] | null }[])[0];
    if (!p?.environment) return false;
    // Strip a stored PostgreSQL set literal ({"commercial_gym"}) to a clean value
    // so it matches the enum switch in generation/equipment resolution.
    const env = p.environment.replace(/^\{"?([^"{}]+)"?\}$/, "$1");
    await this.syncPrimaryFromProfile(userId, env, p.equipment);
    return true;
  }

  async getPrimary(userId: number): Promise<TrainingLocation | undefined> {
    const rows = await this.selectWithRetry(
      () =>
        this.db
          .select()
          .from(trainingLocations)
          .where(
            and(
              eq(trainingLocations.userId, userId),
              eq(trainingLocations.isPrimary, true)
            )
          )
          .limit(1),
      "getPrimary",
      userId
    );
    return (rows as TrainingLocation[])[0];
  }

  private countSecondaries(userId: number): Promise<number> {
    return this.selectWithRetry(
      async () => {
        const rows = await this.db
          .select({ id: trainingLocations.id })
          .from(trainingLocations)
          .where(
            and(
              eq(trainingLocations.userId, userId),
              eq(trainingLocations.isPrimary, false)
            )
          );
        return rows.length;
      },
      "countSecondaries",
      userId
    );
  }

  /**
   * Upsert the single PRIMARY row to match the profile's environment+equipment.
   * Called from profile.service on every step-6 write so the primary row tracks
   * the profile. Preserves a user-chosen name on an existing primary; a new one
   * defaults to "My usual place". Runs inside the caller's flow (profile row is
   * written separately) — this keeps the two in lock-step from one code path.
   */
  async syncPrimaryFromProfile(
    userId: number,
    environment: string | null | undefined,
    equipment: string[] | null | undefined
  ): Promise<TrainingLocation | undefined> {
    if (!environment) return undefined; // nothing to anchor a location on yet
    const resolved = this.resolveEquipment(environment, equipment);

    if (!(await this.getPrimary(userId))) {
      // Idempotent insert. "No primary exists" was read in a separate
      // statement, so a concurrent caller can create one before we get here --
      // getUserLocations' self-heal races itself whenever two requests land
      // together on a user with no primary. Retrying a plain insert could never
      // succeed (the conflicting row is still there), which is why this is a
      // conflict clause and not more retries.
      //
      // Bare onConflictDoNothing() with NO target, as in exercise.service's
      // createExerciseInsertIgnoringConflict: the index to dodge is
      // uq_training_locations_one_primary, a PARTIAL unique index, and
      // Drizzle's typed { target } cannot express its `WHERE is_primary = true`
      // predicate -- it emits `ON CONFLICT ("user_id")`, which Postgres will
      // NOT match to a partial index. Bare ON CONFLICT DO NOTHING covers any
      // unique constraint on the table, and that partial index is the only one
      // an insert here can hit.
      const inserted = await this.insertWithRetry(
        () =>
          this.db
            .insert(trainingLocations)
            .values({
              userId,
              name: DEFAULT_PRIMARY_NAME,
              environment: environment as any,
              equipment: resolved as any,
              isPrimary: true,
            })
            .onConflictDoNothing()
            .returning(),
        "syncPrimaryFromProfile:insert",
        userId
      );
      const row = (inserted as TrainingLocation[])[0];
      if (row) return row;
      // Lost the race: someone else inserted the primary. Fall through and
      // update their row instead of erroring, so a profile edit that raced a
      // self-heal still lands its environment/equipment.
    }

    // Re-read rather than reusing the pre-insert value: on the raced path the
    // row we must update is the winner's, which we have never seen.
    const target = await this.getPrimary(userId);
    if (!target) return undefined;

    const rows = await this.updateWithRetry(
      () =>
        this.db
          .update(trainingLocations)
          .set({
            environment: environment as any,
            equipment: resolved as any,
            updatedAt: createTimestamp(),
          })
          .where(eq(trainingLocations.id, target.id))
          .returning(),
      "syncPrimaryFromProfile:update",
      userId
    );
    return (rows as TrainingLocation[])[0];
  }

  /** Create a saved secondary. Enforces the three-place cap with a stated reason. */
  async createSecondary(
    userId: number,
    input: { name: string; environment: string; equipment?: string[] | null }
  ): Promise<TrainingLocation> {
    const count = await this.countSecondaries(userId);
    if (count >= MAX_SECONDARY_LOCATIONS) {
      throw new LocationCapReachedError();
    }
    const resolved = this.resolveEquipment(input.environment, input.equipment);
    const rows = await this.insertWithRetry(
      () =>
        this.db
          .insert(trainingLocations)
          .values({
            userId,
            name: input.name,
            environment: input.environment as any,
            equipment: resolved as any,
            isPrimary: false,
          })
          .returning(),
      "createSecondary",
      userId
    );
    return (rows as TrainingLocation[])[0];
  }

  /**
   * Edit a place. Renames are free; changing the environment/equipment of the
   * PRIMARY also mirrors into the profile so generation stays consistent.
   */
  async updateLocation(
    userId: number,
    id: number,
    patch: { name?: string; environment?: string; equipment?: string[] | null }
  ): Promise<TrainingLocation> {
    const target = await this.getOwnedLocation(userId, id);

    const set: Record<string, any> = { updatedAt: createTimestamp() };
    if (patch.name !== undefined) set.name = patch.name;
    const envChanging =
      patch.environment !== undefined || patch.equipment !== undefined;
    const nextEnv = patch.environment ?? target.environment;
    if (envChanging) {
      set.environment = nextEnv;
      set.equipment = this.resolveEquipment(nextEnv, patch.equipment ?? target.equipment);
    }

    const rows = await this.updateWithRetry(
      () =>
        this.db
          .update(trainingLocations)
          .set(set)
          .where(eq(trainingLocations.id, id))
          .returning(),
      "updateLocation",
      userId
    );
    const updated = (rows as TrainingLocation[])[0];

    if (target.isPrimary && envChanging) {
      await this.mirrorToProfile(userId, updated.environment, updated.equipment);
    }
    return updated;
  }

  /** Promote a secondary to primary and mirror it into the profile. */
  async makePrimary(userId: number, id: number): Promise<TrainingLocation> {
    const target = await this.getOwnedLocation(userId, id);
    if (target.isPrimary) return target;

    const promoted = await this.db.transaction(async (tx) => {
      // Demote the current primary FIRST so the partial-unique index never sees
      // two primaries mid-transaction.
      await tx
        .update(trainingLocations)
        .set({ isPrimary: false, updatedAt: createTimestamp() })
        .where(
          and(
            eq(trainingLocations.userId, userId),
            eq(trainingLocations.isPrimary, true)
          )
        );
      const rows = await tx
        .update(trainingLocations)
        .set({ isPrimary: true, updatedAt: createTimestamp() })
        .where(eq(trainingLocations.id, id))
        .returning();
      return (rows as TrainingLocation[])[0];
    });

    await this.mirrorToProfile(userId, promoted.environment, promoted.equipment);
    return promoted;
  }

  /** Remove a saved secondary. Refuses to delete the primary. */
  async deleteLocation(userId: number, id: number): Promise<void> {
    const target = await this.getOwnedLocation(userId, id);
    if (target.isPrimary) throw new CannotDeletePrimaryError();

    // §8: an INCOMPLETE future day pointing at this place must fall back to the
    // primary — clear its snapshot so the card shows the usual place again.
    // COMPLETED days keep their frozen snapshot untouched (history stays true).
    await this.updateWithRetry(
      () =>
        this.db
          .update(planDays)
          .set({ locationId: null, locationSnapshot: null })
          .where(
            and(
              eq(planDays.locationId, id),
              eq(planDays.isComplete, false)
            )
          ),
      "deleteLocation:clearIncompleteSnapshots",
      userId
    );

    // plan_days.location_id is ON DELETE SET NULL; completed-day snapshots stay.
    await this.deleteWithRetry(
      () => this.db.delete(trainingLocations).where(eq(trainingLocations.id, id)),
      "deleteLocation",
      userId
    );
  }

  private async getOwnedLocation(
    userId: number,
    id: number
  ): Promise<TrainingLocation> {
    const rows = await this.selectWithRetry(
      () =>
        this.db
          .select()
          .from(trainingLocations)
          .where(
            and(eq(trainingLocations.id, id), eq(trainingLocations.userId, userId))
          )
          .limit(1),
      "getOwnedLocation",
      userId
    );
    const row = (rows as TrainingLocation[])[0];
    if (!row) throw new LocationNotFoundError();
    return row;
  }

  /** Write the profile mirror. The ONLY place profile env/equipment is written outside profile.service. */
  private async mirrorToProfile(
    userId: number,
    environment: string,
    equipment: string[] | null
  ): Promise<void> {
    await this.updateWithRetry(
      () =>
        this.db
          .update(profiles)
          .set({
            environment: environment as any,
            equipment: (equipment ?? []) as any,
            // Match processProfileData: gyms/bodyweight carry no free-text extra.
            otherEquipment:
              environment === WorkoutEnvironments.HOME_GYM ? undefined : "",
            updatedAt: createTimestamp(),
          })
          .where(eq(profiles.userId, userId)),
      "mirrorToProfile",
      userId
    );
  }
}

export const trainingLocationService = new TrainingLocationService();

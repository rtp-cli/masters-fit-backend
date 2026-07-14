import { eq } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import {
  workouts,
  planDays,
  workoutBlocks,
  planDayExercises,
} from "@/models/workout.schema";
import {
  exerciseLogs,
  exerciseSetLogs,
  blockLogs,
  planDayLogs,
  workoutLogs,
} from "@/models/logs.schema";
import { profiles } from "@/models/profile.schema";
import { backgroundJobs } from "@/models/jobs.schema";

/**
 * The set of object types whose ownership can be resolved to a single owning
 * userId. Used by the requireOwnership() middleware to verify that the
 * authenticated user actually owns the object a route acts on.
 *
 * IMPORTANT: this is the server-side source of truth for object-level
 * authorization. Every ID-keyed route must resolve ownership through here —
 * NEVER trust a userId supplied in the path or body of an object-keyed route.
 */
export type OwnedObjectType =
  | "workout"
  | "planDay"
  | "workoutBlock"
  | "planDayExercise"
  | "exerciseLog"
  | "exerciseSetLog"
  | "blockLog"
  | "planDayLog"
  | "workoutLog"
  | "profile"
  | "job";

/**
 * Resolves an object id to the userId that owns it by walking the ownership
 * chain up to `workouts.userId` (or reading the direct userId column for
 * user-scoped tables). Returns null when the object does not exist.
 *
 * Ownership chains (per src/models/*.schema.ts):
 *   workout            -> workouts.userId
 *   planDay            -> workouts (via workoutId)
 *   workoutBlock       -> planDays -> workouts
 *   planDayExercise    -> workoutBlocks -> planDays -> workouts
 *   exerciseLog        -> planDayExercises -> workoutBlocks -> planDays -> workouts
 *   exerciseSetLog     -> exerciseLogs -> ... -> workouts
 *   blockLog           -> workoutBlocks -> planDays -> workouts
 *   planDayLog         -> planDays -> workouts
 *   workoutLog         -> workouts (via workoutId)
 *   profile            -> profiles.userId
 *   job                -> background_jobs.userId
 */
export class OwnershipService extends BaseService {
  async resolveOwnerUserId(
    type: OwnedObjectType,
    id: number
  ): Promise<number | null> {
    if (!Number.isInteger(id) || id <= 0) return null;

    return this.selectWithRetry(async () => {
      let rows: { userId: number | null }[] = [];

      switch (type) {
        case "workout":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(workouts)
            .where(eq(workouts.id, id))
            .limit(1);
          break;

        case "planDay":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(planDays)
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .where(eq(planDays.id, id))
            .limit(1);
          break;

        case "workoutBlock":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(workoutBlocks)
            .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .where(eq(workoutBlocks.id, id))
            .limit(1);
          break;

        case "planDayExercise":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(planDayExercises)
            .innerJoin(
              workoutBlocks,
              eq(planDayExercises.workoutBlockId, workoutBlocks.id)
            )
            .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .where(eq(planDayExercises.id, id))
            .limit(1);
          break;

        case "exerciseLog":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(exerciseLogs)
            .innerJoin(
              planDayExercises,
              eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
            )
            .innerJoin(
              workoutBlocks,
              eq(planDayExercises.workoutBlockId, workoutBlocks.id)
            )
            .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .where(eq(exerciseLogs.id, id))
            .limit(1);
          break;

        case "exerciseSetLog":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(exerciseSetLogs)
            .innerJoin(
              exerciseLogs,
              eq(exerciseSetLogs.exerciseLogId, exerciseLogs.id)
            )
            .innerJoin(
              planDayExercises,
              eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
            )
            .innerJoin(
              workoutBlocks,
              eq(planDayExercises.workoutBlockId, workoutBlocks.id)
            )
            .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .where(eq(exerciseSetLogs.id, id))
            .limit(1);
          break;

        case "blockLog":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(blockLogs)
            .innerJoin(
              workoutBlocks,
              eq(blockLogs.workoutBlockId, workoutBlocks.id)
            )
            .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .where(eq(blockLogs.id, id))
            .limit(1);
          break;

        case "planDayLog":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(planDayLogs)
            .innerJoin(planDays, eq(planDayLogs.planDayId, planDays.id))
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .where(eq(planDayLogs.id, id))
            .limit(1);
          break;

        case "workoutLog":
          rows = await this.db
            .select({ userId: workouts.userId })
            .from(workoutLogs)
            .innerJoin(workouts, eq(workoutLogs.workoutId, workouts.id))
            .where(eq(workoutLogs.id, id))
            .limit(1);
          break;

        case "profile":
          rows = await this.db
            .select({ userId: profiles.userId })
            .from(profiles)
            .where(eq(profiles.id, id))
            .limit(1);
          break;

        case "job":
          rows = await this.db
            .select({ userId: backgroundJobs.userId })
            .from(backgroundJobs)
            .where(eq(backgroundJobs.id, id))
            .limit(1);
          break;

        default:
          return null;
      }

      return rows[0]?.userId ?? null;
    }, `resolveOwnerUserId:${type}`);
  }
}

export const ownershipService = new OwnershipService();

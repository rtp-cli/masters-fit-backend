import { BaseService } from "@/services/base.service";
import { createHash } from "crypto";
import { eq, inArray, or } from "drizzle-orm";
import { isProtectedUser } from "@/constants/protected-accounts";
import {
  users, workouts, planDays, workoutBlocks, planDayExercises, exerciseLogs,
  exerciseSetLogs, planDayLogs, workoutLogs, blockLogs, shareLinks, aiOperations,
  backgroundJobs, trialUsage, userSubscriptions, profiles, prompts,
  impersonationAudit, appFeedback, planDayFeedback, accountDeletionLog,
  trainingLocations,
} from "@/models";
import type { UpdateUser, User } from "@/models";
import { CURRENT_WAIVER_VERSION } from "@/constants/waiver";

/** Normalize an email the same way everywhere before hashing (trim + lowercase). */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export interface PurgeMeta {
  /** Who triggered the deletion. */
  source: "self_service" | "ops_script" | "admin";
  /** Plaintext email — hashed for the audit log, never stored raw. */
  email: string;
  uuid?: string | null;
  /** Operator/admin identifier for non-self-service deletions. */
  actor?: string | null;
  reason?: string | null;
}

/**
 * Delete a user and EVERY row they own, children-first, using the transaction
 * handle `tx`. Single source of truth for the teardown — shared by the in-app
 * Delete Account flow (userService.deleteAccount) and the delete-user ops
 * script, so the two can never drift (that drift is what silently missed
 * app_feedback / plan_day_feedback before). FK-CASCADE tables (refresh_tokens,
 * llm_generation_logs, exercise_exclusions, …) are removed by the final users
 * delete. If a new NO-ACTION FK → users is added later, add it here.
 */
export async function purgeUserData(tx: any, userId: number, meta: PurgeMeta): Promise<void> {
  // Hard stop: never purge an admin/owner or otherwise protected account. This
  // is the single chokepoint for BOTH the in-app flow and the ops script, so the
  // guard can't be bypassed by either path. Throws before any row is touched.
  if (isProtectedUser(userId, meta.email)) {
    throw new Error(
      `Refusing to hard-delete a protected account (id=${userId}, ${meta.email}). ` +
        `Remove it from PROTECTED_EMAILS / ADMIN_USER_IDS first if this is truly intended.`
    );
  }

  const counts: Record<string, number> = {};
  const ws = await tx.select({ id: workouts.id }).from(workouts).where(eq(workouts.userId, userId));
  const workoutIds = ws.map((w: any) => w.id);
  counts.workouts = workoutIds.length;

  // userId-scoped child deletes — run regardless of whether the user has any
  // workouts. Ordered children-before-parents: ai_operations before
  // background_jobs + workouts; plan_day_feedback + share_links before plan_days.
  await tx.delete(planDayFeedback).where(eq(planDayFeedback.userId, userId));
  await tx.delete(shareLinks).where(eq(shareLinks.userId, userId));
  await tx.delete(aiOperations).where(eq(aiOperations.userId, userId));
  await tx.delete(backgroundJobs).where(eq(backgroundJobs.userId, userId));

  if (workoutIds.length) {
    const days = await tx.select({ id: planDays.id }).from(planDays).where(inArray(planDays.workoutId, workoutIds));
    const dayIds = days.map((d: any) => d.id);
    const blocks = dayIds.length ? await tx.select({ id: workoutBlocks.id }).from(workoutBlocks).where(inArray(workoutBlocks.planDayId, dayIds)) : [];
    const blockIds = blocks.map((b: any) => b.id);
    const pdes = blockIds.length ? await tx.select({ id: planDayExercises.id }).from(planDayExercises).where(inArray(planDayExercises.workoutBlockId, blockIds)) : [];
    const pdeIds = pdes.map((p: any) => p.id);
    const elogs = pdeIds.length ? await tx.select({ id: exerciseLogs.id }).from(exerciseLogs).where(inArray(exerciseLogs.planDayExerciseId, pdeIds)) : [];
    const elogIds = elogs.map((e: any) => e.id);
    counts.planDays = dayIds.length;
    counts.workoutBlocks = blockIds.length;
    counts.planDayExercises = pdeIds.length;
    counts.exerciseLogs = elogIds.length;

    if (elogIds.length) await tx.delete(exerciseSetLogs).where(inArray(exerciseSetLogs.exerciseLogId, elogIds));
    if (pdeIds.length) await tx.delete(exerciseLogs).where(inArray(exerciseLogs.planDayExerciseId, pdeIds));
    if (dayIds.length) await tx.delete(planDayLogs).where(inArray(planDayLogs.planDayId, dayIds));
    await tx.delete(workoutLogs).where(inArray(workoutLogs.workoutId, workoutIds));
    if (blockIds.length) await tx.delete(planDayExercises).where(inArray(planDayExercises.workoutBlockId, blockIds));
    if (blockIds.length) await tx.delete(blockLogs).where(inArray(blockLogs.workoutBlockId, blockIds));
    if (dayIds.length) await tx.delete(workoutBlocks).where(inArray(workoutBlocks.planDayId, dayIds));
    await tx.delete(planDays).where(inArray(planDays.workoutId, workoutIds));
    // NO-ACTION FKs to workouts can be held by rows owned by ANOTHER (kept) user
    // — e.g. a background_job or ai_operation created during impersonation/regen
    // that points at this user's workout. The deleting user's own such rows are
    // already gone (deleted by user_id above), but a kept user's dangling pointer
    // would trip the FK on the workout delete below. Null them (both cols nullable).
    await tx.update(backgroundJobs).set({ workoutId: null }).where(inArray(backgroundJobs.workoutId, workoutIds));
    await tx.update(aiOperations).set({ resultWorkoutId: null }).where(inArray(aiOperations.resultWorkoutId, workoutIds));
    await tx.delete(workouts).where(eq(workouts.userId, userId));
  }

  await tx.delete(appFeedback).where(eq(appFeedback.userId, userId));
  await tx.delete(trialUsage).where(eq(trialUsage.userId, userId));
  await tx.delete(userSubscriptions).where(eq(userSubscriptions.userId, userId));
  await tx.delete(trainingLocations).where(eq(trainingLocations.userId, userId));
  await tx.delete(profiles).where(eq(profiles.userId, userId));
  await tx.delete(prompts).where(eq(prompts.userId, userId));
  await tx.delete(impersonationAudit).where(or(eq(impersonationAudit.targetUserId, userId), eq(impersonationAudit.adminUserId, userId)));

  // Audit record — written in the same transaction, so it commits iff the purge
  // does. No FK to users, so it survives the delete on the next line.
  await tx.insert(accountDeletionLog).values({
    deletedUserId: userId,
    uuid: meta.uuid ?? null,
    emailHash: hashEmail(meta.email),
    source: meta.source,
    actor: meta.actor ?? null,
    rowsDeleted: counts,
    reason: meta.reason ?? null,
  });

  await tx.delete(users).where(eq(users.id, userId));
}

export class UserService extends BaseService {
  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(this.eq(users.email, email));
    return result[0];
  }

  async getUser(id: number): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(this.eq(users.id, id));
    return result[0];
  }

  async getUserById(id: number): Promise<User | undefined> {
    return this.getUser(id);
  }

  async getUserByUuid(uuid: string): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(this.eq(users.uuid, uuid));
    return result[0];
  }

  async createUser(data: { email: string; name: string }): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    return result[0];
  }

  async updateUser(id: number, data: Partial<UpdateUser>): Promise<User> {
    const result = await this.db
      .update(users)
      .set({
        ...(data.email !== undefined &&
          data.email !== null && { email: data.email }),
        ...(data.name !== undefined &&
          data.name !== null && { name: data.name }),
        ...(data.needsOnboarding !== undefined &&
          data.needsOnboarding !== null && {
            needsOnboarding: data.needsOnboarding,
          }),
        ...(data.pushNotificationToken !== undefined && {
          pushNotificationToken: data.pushNotificationToken,
        }),
        ...(data.waiverAcceptedAt !== undefined && {
          waiverAcceptedAt: data.waiverAcceptedAt,
        }),
        ...(data.waiverVersion !== undefined && {
          waiverVersion: data.waiverVersion,
        }),
        ...(data.isActive !== undefined &&
          data.isActive !== null && {
            isActive: data.isActive,
          }),
        ...(data.themeMode !== undefined && {
          themeMode: data.themeMode,
        }),
        ...(data.colorTheme !== undefined && {
          colorTheme: data.colorTheme,
        }),
      })
      .where(this.eq(users.id, id))
      .returning();
    return result[0];
  }

  async updateUserByEmail(data: Partial<UpdateUser>): Promise<User> {
    const result = await this.db
      .update(users)
      .set({
        ...(data.name !== undefined &&
          data.name !== null && { name: data.name }),
        ...(data.needsOnboarding !== undefined &&
          data.needsOnboarding !== null && {
            needsOnboarding: data.needsOnboarding,
          }),
        ...(data.pushNotificationToken !== undefined && {
          pushNotificationToken: data.pushNotificationToken,
        }),
        ...(data.waiverAcceptedAt !== undefined && {
          waiverAcceptedAt: data.waiverAcceptedAt,
        }),
        ...(data.waiverVersion !== undefined && {
          waiverVersion: data.waiverVersion,
        }),
        ...(data.isActive !== undefined &&
          data.isActive !== null && {
            isActive: data.isActive,
          }),
        ...(data.themeMode !== undefined && {
          themeMode: data.themeMode,
        }),
        ...(data.colorTheme !== undefined && {
          colorTheme: data.colorTheme,
        }),
      })
      .where(this.eq(users.email, data.email!))
      .returning();
    return result[0];
  }

  async acceptWaiver(userId: number, version: string): Promise<User> {
    // Validate version before updating
    if (version !== CURRENT_WAIVER_VERSION) {
      throw new Error(
        `Invalid waiver version. Expected ${CURRENT_WAIVER_VERSION}, received ${version}`
      );
    }

    const result = await this.db
      .update(users)
      .set({
        waiverAcceptedAt: new Date(),
        waiverVersion: version,
      })
      .where(this.eq(users.id, userId))
      .returning();
    return result[0];
  }

  async hasAcceptedWaiver(
    userId: number,
    requiredVersion?: string
  ): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user || !user.waiverAcceptedAt) {
      return false;
    }

    // Use the required version or default to current version
    const versionToCheck = requiredVersion || CURRENT_WAIVER_VERSION;

    // Check if user has accepted the specific version (exact match required)
    if (user.waiverVersion !== versionToCheck) {
      return false;
    }

    return true;
  }

  async hasAcceptedCurrentWaiver(userId: number): Promise<boolean> {
    return this.hasAcceptedWaiver(userId, CURRENT_WAIVER_VERSION);
  }

  /**
   * Permanently delete a user and ALL their data (hard delete), in one
   * transaction. Matches the in-app promise ("permanently deleted") and app-
   * store / GDPR account-deletion requirements. Returns the user's uuid so the
   * caller can also purge the external analytics profile. Irreversible.
   */
  async deleteAccount(userId: number): Promise<{ uuid: string }> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }
    const uuid = user.uuid;
    await this.db.transaction(async (tx) => {
      await purgeUserData(tx, userId, {
        source: "self_service",
        email: user.email,
        uuid,
      });
    });
    return { uuid };
  }
}

export const userService = new UserService();

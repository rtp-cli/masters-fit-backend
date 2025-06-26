import {
  exerciseLogs,
  blockLogs,
  planDayLogs,
  workoutLogs,
  InsertExerciseLog,
  InsertBlockLog,
  InsertPlanDayLog,
  InsertWorkoutLog,
  UpdateExerciseLog,
  UpdateBlockLog,
  UpdatePlanDayLog,
  UpdateWorkoutLog,
} from "@/models";
import {
  planDayExercises,
  workoutBlocks,
  planDays,
} from "@/models/workout.schema";
import { BaseService } from "./base.service";
import { eq, and, inArray, desc, count, sum } from "drizzle-orm";

// Helper function to convert decimal string to number
const parseDecimal = (value: string | null): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
};

export class LogsService extends BaseService {
  // ==================== EXERCISE LOGS ====================

  async createExerciseLog(data: InsertExerciseLog) {
    // Convert weightUsed to string for decimal field
    const insertData = {
      ...data,
      weightUsed: data.weightUsed ? data.weightUsed.toString() : null,
    };

    const [createdExerciseLog] = await this.db
      .insert(exerciseLogs)
      .values(insertData)
      .returning();

    // Convert decimal fields back to numbers for interface compatibility
    return {
      ...createdExerciseLog,
      weightUsed: parseDecimal(createdExerciseLog.weightUsed),
    };
  }

  async updateExerciseLog(exerciseLogId: number, data: UpdateExerciseLog) {
    // Convert weightUsed to string for decimal field
    const updateData = {
      ...data,
      weightUsed: data.weightUsed ? data.weightUsed.toString() : undefined,
      updatedAt: new Date(),
    };

    const [updatedExerciseLog] = await this.db
      .update(exerciseLogs)
      .set(updateData)
      .where(eq(exerciseLogs.id, exerciseLogId))
      .returning();

    // Convert decimal fields back to numbers for interface compatibility
    return {
      ...updatedExerciseLog,
      weightUsed: parseDecimal(updatedExerciseLog.weightUsed),
    };
  }

  async getExerciseLog(exerciseLogId: number) {
    const log = await this.db.query.exerciseLogs.findFirst({
      where: eq(exerciseLogs.id, exerciseLogId),
    });

    if (!log) return null;

    // Convert decimal fields back to numbers for interface compatibility
    return {
      ...log,
      weightUsed: parseDecimal(log.weightUsed),
    };
  }

  async getExerciseLogsForPlanDayExercise(planDayExerciseId: number) {
    const logs = await this.db.query.exerciseLogs.findMany({
      where: eq(exerciseLogs.planDayExerciseId, planDayExerciseId),
      orderBy: [desc(exerciseLogs.createdAt)],
    });

    // Convert decimal fields back to numbers for interface compatibility
    return logs.map((log) => ({
      ...log,
      weightUsed: parseDecimal(log.weightUsed),
    }));
  }

  async getExerciseLogsForPlanDayExercises(planDayExerciseIds: number[]) {
    const logs = await this.db.query.exerciseLogs.findMany({
      where: inArray(exerciseLogs.planDayExerciseId, planDayExerciseIds),
      orderBy: [desc(exerciseLogs.createdAt)],
    });

    // Convert decimal fields back to numbers for interface compatibility
    return logs.map((log) => ({
      ...log,
      weightUsed: parseDecimal(log.weightUsed),
    }));
  }

  async getExerciseLogsForWorkoutBlock(workoutBlockId: number) {
    // Get all exercises in the block, then get their logs
    const blockExercises = await this.db.query.planDayExercises.findMany({
      where: eq(planDayExercises.workoutBlockId, workoutBlockId),
    });

    const exerciseIds = blockExercises.map((ex) => ex.id);
    if (exerciseIds.length === 0) return [];

    const logs = await this.db.query.exerciseLogs.findMany({
      where: inArray(exerciseLogs.planDayExerciseId, exerciseIds),
      orderBy: [desc(exerciseLogs.createdAt)],
    });

    // Convert decimal fields back to numbers for interface compatibility
    return logs.map((log) => ({
      ...log,
      weightUsed: parseDecimal(log.weightUsed),
    }));
  }

  // ==================== BLOCK LOGS ====================

  async createBlockLog(data: InsertBlockLog) {
    const [createdBlockLog] = await this.db
      .insert(blockLogs)
      .values(data)
      .returning();
    return createdBlockLog;
  }

  async updateBlockLog(blockLogId: number, data: UpdateBlockLog) {
    const [updatedBlockLog] = await this.db
      .update(blockLogs)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(blockLogs.id, blockLogId))
      .returning();
    return updatedBlockLog;
  }

  async getBlockLog(blockLogId: number) {
    return await this.db.query.blockLogs.findFirst({
      where: eq(blockLogs.id, blockLogId),
    });
  }

  async getBlockLogsForWorkoutBlock(workoutBlockId: number) {
    return await this.db.query.blockLogs.findMany({
      where: eq(blockLogs.workoutBlockId, workoutBlockId),
      orderBy: [desc(blockLogs.createdAt)],
    });
  }

  async getLatestBlockLogForWorkoutBlock(workoutBlockId: number) {
    return await this.db.query.blockLogs.findFirst({
      where: eq(blockLogs.workoutBlockId, workoutBlockId),
      orderBy: [desc(blockLogs.createdAt)],
    });
  }

  async getBlockLogsForPlanDay(planDayId: number) {
    // Get all blocks in the plan day, then get their logs
    const planDayBlocks = await this.db.query.workoutBlocks.findMany({
      where: eq(workoutBlocks.planDayId, planDayId),
    });

    const blockIds = planDayBlocks.map((block) => block.id);
    if (blockIds.length === 0) return [];

    return await this.db.query.blockLogs.findMany({
      where: inArray(blockLogs.workoutBlockId, blockIds),
      orderBy: [desc(blockLogs.createdAt)],
    });
  }

  // ==================== PLAN DAY LOGS ====================

  async createPlanDayLog(data: InsertPlanDayLog) {
    const [createdPlanDayLog] = await this.db
      .insert(planDayLogs)
      .values(data)
      .returning();
    return createdPlanDayLog;
  }

  async updatePlanDayLog(planDayLogId: number, data: UpdatePlanDayLog) {
    const [updatedPlanDayLog] = await this.db
      .update(planDayLogs)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(planDayLogs.id, planDayLogId))
      .returning();
    return updatedPlanDayLog;
  }

  async getPlanDayLog(planDayLogId: number) {
    return await this.db.query.planDayLogs.findFirst({
      where: eq(planDayLogs.id, planDayLogId),
    });
  }

  async getPlanDayLogsForPlanDay(planDayId: number) {
    return await this.db.query.planDayLogs.findMany({
      where: eq(planDayLogs.planDayId, planDayId),
      orderBy: [desc(planDayLogs.createdAt)],
    });
  }

  async getLatestPlanDayLogForPlanDay(planDayId: number) {
    return await this.db.query.planDayLogs.findFirst({
      where: eq(planDayLogs.planDayId, planDayId),
      orderBy: [desc(planDayLogs.createdAt)],
    });
  }

  async getPlanDayLogsForWorkout(workoutId: number) {
    // Get all plan days in the workout, then get their logs
    const workoutPlanDays = await this.db.query.planDays.findMany({
      where: eq(planDays.workoutId, workoutId),
    });

    const planDayIds = workoutPlanDays.map((day) => day.id);
    if (planDayIds.length === 0) return [];

    return await this.db.query.planDayLogs.findMany({
      where: inArray(planDayLogs.planDayId, planDayIds),
      orderBy: [desc(planDayLogs.createdAt)],
    });
  }

  // ==================== WORKOUT LOGS ====================

  async createWorkoutLog(data: InsertWorkoutLog) {
    // Convert averageRating to string for decimal field
    const insertData = {
      ...data,
      averageRating: data.averageRating ? data.averageRating.toString() : null,
    };

    const [createdWorkoutLog] = await this.db
      .insert(workoutLogs)
      .values(insertData)
      .returning();

    // Convert decimal fields back to numbers for interface compatibility
    return {
      ...createdWorkoutLog,
      averageRating: parseDecimal(createdWorkoutLog.averageRating),
    };
  }

  async updateWorkoutLog(workoutId: number, data: UpdateWorkoutLog) {
    const existingLog = await this.getLatestWorkoutLogForWorkout(workoutId);

    if (!existingLog) {
      throw new Error("Workout log not found");
    }

    // Convert averageRating to string for decimal field
    const updateData = {
      ...data,
      averageRating: data.averageRating
        ? data.averageRating.toString()
        : undefined,
      updatedAt: new Date(),
    };

    const [updatedWorkoutLog] = await this.db
      .update(workoutLogs)
      .set(updateData)
      .where(eq(workoutLogs.id, existingLog.id))
      .returning();

    // Convert decimal fields back to numbers for interface compatibility
    return {
      ...updatedWorkoutLog,
      averageRating: parseDecimal(updatedWorkoutLog.averageRating),
    };
  }

  async getWorkoutLog(workoutLogId: number) {
    const log = await this.db.query.workoutLogs.findFirst({
      where: eq(workoutLogs.id, workoutLogId),
    });

    if (!log) return null;

    // Convert decimal fields back to numbers for interface compatibility
    return {
      ...log,
      averageRating: parseDecimal(log.averageRating),
    };
  }

  async getLatestWorkoutLogForWorkout(workoutId: number) {
    const log = await this.db.query.workoutLogs.findFirst({
      where: eq(workoutLogs.workoutId, workoutId),
      orderBy: [desc(workoutLogs.createdAt)],
    });

    if (!log) return null;

    // Convert decimal fields back to numbers for interface compatibility
    return {
      ...log,
      averageRating: parseDecimal(log.averageRating),
    };
  }

  async getWorkoutLogsForWorkout(workoutId: number) {
    const logs = await this.db.query.workoutLogs.findMany({
      where: eq(workoutLogs.workoutId, workoutId),
      orderBy: [desc(workoutLogs.createdAt)],
    });

    // Convert decimal fields back to numbers for interface compatibility
    return logs.map((log) => ({
      ...log,
      averageRating: parseDecimal(log.averageRating),
    }));
  }

  async getOrCreateWorkoutLog(workoutId: number) {
    let workoutLog = await this.getLatestWorkoutLogForWorkout(workoutId);

    if (!workoutLog) {
      workoutLog = await this.createWorkoutLog({
        workoutId,
        isComplete: false,
        isActive: true,
        totalTimeMinutes: 0,
        daysCompleted: 0,
        totalDays: 0,
        completedExercises: [],
        completedBlocks: [],
        completedDays: [],
        notes: "",
      });
    }

    return workoutLog;
  }

  // ==================== COMPLETION TRACKING ====================

  async addCompletedExercise(workoutId: number, planDayExerciseId: number) {
    const workoutLog = await this.getOrCreateWorkoutLog(workoutId);

    const currentCompleted = workoutLog.completedExercises || [];
    if (!currentCompleted.includes(planDayExerciseId)) {
      const updatedCompleted = [...currentCompleted, planDayExerciseId];

      await this.updateWorkoutLog(workoutId, {
        completedExercises: updatedCompleted,
      });
    }

    return this.getLatestWorkoutLogForWorkout(workoutId);
  }

  async addCompletedBlock(workoutId: number, workoutBlockId: number) {
    const workoutLog = await this.getOrCreateWorkoutLog(workoutId);

    const currentCompleted = workoutLog.completedBlocks || [];
    if (!currentCompleted.includes(workoutBlockId)) {
      const updatedCompleted = [...currentCompleted, workoutBlockId];

      await this.updateWorkoutLog(workoutId, {
        completedBlocks: updatedCompleted,
      });
    }

    return this.getLatestWorkoutLogForWorkout(workoutId);
  }

  async addCompletedDay(workoutId: number, planDayId: number) {
    const workoutLog = await this.getOrCreateWorkoutLog(workoutId);

    const currentCompleted = workoutLog.completedDays || [];
    if (!currentCompleted.includes(planDayId)) {
      const updatedCompleted = [...currentCompleted, planDayId];

      await this.updateWorkoutLog(workoutId, {
        completedDays: updatedCompleted,
        daysCompleted: (workoutLog.daysCompleted || 0) + 1,
      });
    }

    return this.getLatestWorkoutLogForWorkout(workoutId);
  }

  // ==================== AGGREGATION METHODS ====================

  async getWorkoutProgress(workoutId: number) {
    const workoutLog = await this.getLatestWorkoutLogForWorkout(workoutId);
    if (!workoutLog) return null;

    // Get total counts for comparison
    const totalExercises = await this.getTotalExercisesForWorkout(workoutId);
    const totalBlocks = await this.getTotalBlocksForWorkout(workoutId);
    const totalDays = await this.getTotalDaysForWorkout(workoutId);

    return {
      workoutLog,
      progress: {
        exercises: {
          completed: workoutLog.completedExercises?.length || 0,
          total: totalExercises,
          percentage:
            totalExercises > 0
              ? Math.round(
                  ((workoutLog.completedExercises?.length || 0) /
                    totalExercises) *
                    100
                )
              : 0,
        },
        blocks: {
          completed: workoutLog.completedBlocks?.length || 0,
          total: totalBlocks,
          percentage:
            totalBlocks > 0
              ? Math.round(
                  ((workoutLog.completedBlocks?.length || 0) / totalBlocks) *
                    100
                )
              : 0,
        },
        days: {
          completed: workoutLog.daysCompleted || 0,
          total: totalDays,
          percentage:
            totalDays > 0
              ? Math.round(((workoutLog.daysCompleted || 0) / totalDays) * 100)
              : 0,
        },
      },
    };
  }

  async getPlanDayProgress(planDayId: number) {
    const planDayLog = await this.getLatestPlanDayLogForPlanDay(planDayId);
    if (!planDayLog) return null;

    // Get total counts for comparison
    const totalExercises = await this.getTotalExercisesForPlanDay(planDayId);
    const totalBlocks = await this.getTotalBlocksForPlanDay(planDayId);

    return {
      planDayLog,
      progress: {
        exercises: {
          completed: planDayLog.exercisesCompleted || 0,
          total: totalExercises,
          percentage:
            totalExercises > 0
              ? Math.round(
                  ((planDayLog.exercisesCompleted || 0) / totalExercises) * 100
                )
              : 0,
        },
        blocks: {
          completed: planDayLog.blocksCompleted || 0,
          total: totalBlocks,
          percentage:
            totalBlocks > 0
              ? Math.round(
                  ((planDayLog.blocksCompleted || 0) / totalBlocks) * 100
                )
              : 0,
        },
      },
    };
  }

  // ==================== HELPER METHODS ====================

  private async getTotalExercisesForWorkout(
    workoutId: number
  ): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(planDayExercises)
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
      .where(eq(planDays.workoutId, workoutId));

    return result[0]?.count || 0;
  }

  private async getTotalBlocksForWorkout(workoutId: number): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(workoutBlocks)
      .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
      .where(eq(planDays.workoutId, workoutId));

    return result[0]?.count || 0;
  }

  private async getTotalDaysForWorkout(workoutId: number): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(planDays)
      .where(eq(planDays.workoutId, workoutId));

    return result[0]?.count || 0;
  }

  private async getTotalExercisesForPlanDay(
    planDayId: number
  ): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(planDayExercises)
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .where(eq(workoutBlocks.planDayId, planDayId));

    return result[0]?.count || 0;
  }

  private async getTotalBlocksForPlanDay(planDayId: number): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(workoutBlocks)
      .where(eq(workoutBlocks.planDayId, planDayId));

    return result[0]?.count || 0;
  }

  // ==================== LEGACY METHODS (for backward compatibility) ====================

  async getExerciseLogsForPlanDay(planDayId: number) {
    // This method is kept for backward compatibility
    // It now returns exercise logs for all exercises in a plan day
    const planDayBlocks = await this.db.query.workoutBlocks.findMany({
      where: eq(workoutBlocks.planDayId, planDayId),
    });

    const blockIds = planDayBlocks.map((block) => block.id);
    if (blockIds.length === 0) return [];

    const blockExercises = await this.db.query.planDayExercises.findMany({
      where: inArray(planDayExercises.workoutBlockId, blockIds),
    });

    const exerciseIds = blockExercises.map((ex) => ex.id);
    if (exerciseIds.length === 0) return [];

    const logs = await this.db.query.exerciseLogs.findMany({
      where: inArray(exerciseLogs.planDayExerciseId, exerciseIds),
      orderBy: [desc(exerciseLogs.createdAt)],
    });

    // Convert decimal fields back to numbers for interface compatibility
    return logs.map((log) => ({
      ...log,
      weightUsed: parseDecimal(log.weightUsed),
    }));
  }

  async getCompletedExercisesCount(workoutId: number) {
    const workoutLog = await this.getLatestWorkoutLogForWorkout(workoutId);
    return workoutLog?.completedExercises?.length || 0;
  }

  async getCompletedExercisesForWorkout(workoutId: number) {
    const workoutLog = await this.getLatestWorkoutLogForWorkout(workoutId);
    return workoutLog?.completedExercises || [];
  }

  async markWorkoutComplete(
    workoutId: number,
    totalExerciseIds: number[]
  ): Promise<void> {
    const workoutLog = await this.getLatestWorkoutLogForWorkout(workoutId);
    if (!workoutLog) return;

    const completedExercises = workoutLog.completedExercises || [];
    const isComplete = totalExerciseIds.every((id) =>
      completedExercises.includes(id)
    );

    if (isComplete !== workoutLog.isComplete) {
      await this.updateWorkoutLog(workoutId, {
        isComplete,
      });
    }
  }
}

export const logsService = new LogsService();

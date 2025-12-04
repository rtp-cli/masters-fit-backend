import {
  exerciseLogs,
  exerciseSetLogs,
  blockLogs,
  planDayLogs,
  workoutLogs,
  InsertExerciseLog,
  InsertExerciseSetLog,
  InsertBlockLog,
  InsertPlanDayLog,
  InsertWorkoutLog,
  UpdateExerciseLog,
  UpdateExerciseSetLog,
  UpdateBlockLog,
  UpdatePlanDayLog,
  UpdateWorkoutLog,
  ExerciseSetLog,
} from "@/models";
import {
  planDayExercises,
  workoutBlocks,
  planDays,
  workouts,
} from "@/models/workout.schema";
import { users } from "@/models/user.schema";
import { BaseService } from "./base.service";
import { eventTrackingService } from "./event-tracking.service";
import { eq, and, inArray, desc, count, sum } from "drizzle-orm";

// Helper function to convert decimal string to number
const parseDecimal = (value: string | null): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
};

export class LogsService extends BaseService {
  // ==================== EXERCISE LOGS ====================

  async createExerciseLog(data: {
    planDayExerciseId: number;
    sets: Array<{
      roundNumber: number;
      setNumber: number;
      weight: number;
      reps: number;
      restAfter?: number;
    }>;
    durationCompleted?: number;
    timeTaken?: number;
    notes?: string;
    difficulty?: string;
    rating?: number;
  }) {
    const { sets, ...exerciseLogData } = data;

    // Create parent exercise log
    const [createdExerciseLog] = await this.db
      .insert(exerciseLogs)
      .values({
        ...exerciseLogData,
        isComplete: true, // If they're logging sets, they completed it
      })
      .returning();

    // Create set logs (only if sets array is not empty)
    let createdSetLogs: any[] = [];
    if (sets && sets.length > 0) {
      const setLogsData = sets.map((set) => ({
        exerciseLogId: createdExerciseLog.id,
        roundNumber: set.roundNumber,
        setNumber: set.setNumber,
        weight: set.weight ? set.weight.toString() : null,
        reps: set.reps,
        restAfter: set.restAfter,
      }));

      createdSetLogs = await this.db
        .insert(exerciseSetLogs)
        .values(setLogsData)
        .returning();
    }

    // Convert decimal fields back to numbers
    const setsWithNumbers = createdSetLogs.map((set) => ({
      ...set,
      weight: parseDecimal(set.weight),
    }));

    return {
      ...createdExerciseLog,
      sets: setsWithNumbers,
    };
  }

  async updateExerciseLog(exerciseLogId: number, data: UpdateExerciseLog) {
    const [updatedExerciseLog] = await this.db
      .update(exerciseLogs)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(exerciseLogs.id, exerciseLogId))
      .returning();

    return updatedExerciseLog;
  }

  async createExerciseSetLog(data: InsertExerciseSetLog) {
    const insertData = {
      ...data,
      weight: data.weight ? data.weight.toString() : null,
    };

    const [createdSetLog] = await this.db
      .insert(exerciseSetLogs)
      .values(insertData)
      .returning();

    return {
      ...createdSetLog,
      weight: parseDecimal(createdSetLog.weight),
    };
  }

  async updateExerciseSetLog(setLogId: number, data: UpdateExerciseSetLog) {
    const updateData = {
      ...data,
      weight:
        data.weight !== undefined
          ? data.weight
            ? data.weight.toString()
            : null
          : undefined,
    };

    const [updatedSetLog] = await this.db
      .update(exerciseSetLogs)
      .set(updateData)
      .where(eq(exerciseSetLogs.id, setLogId))
      .returning();

    return {
      ...updatedSetLog,
      weight: parseDecimal(updatedSetLog.weight),
    };
  }

  async getExerciseLog(exerciseLogId: number) {
    const log = await this.db.query.exerciseLogs.findFirst({
      where: eq(exerciseLogs.id, exerciseLogId),
    });

    if (!log) return null;

    // Get associated set logs
    const sets = await this.db.query.exerciseSetLogs.findMany({
      where: eq(exerciseSetLogs.exerciseLogId, exerciseLogId),
      orderBy: [exerciseSetLogs.roundNumber, exerciseSetLogs.setNumber],
    });

    return {
      ...log,
      sets: sets.map((set) => ({
        ...set,
        weight: parseDecimal(set.weight),
      })),
    };
  }

  async getExerciseLogsForPlanDayExercise(planDayExerciseId: number) {
    const logs = await this.db.query.exerciseLogs.findMany({
      where: eq(exerciseLogs.planDayExerciseId, planDayExerciseId),
      orderBy: [desc(exerciseLogs.createdAt)],
    });

    // Get sets for each log
    const logsWithSets = await Promise.all(
      logs.map(async (log) => {
        const sets = await this.db.query.exerciseSetLogs.findMany({
          where: eq(exerciseSetLogs.exerciseLogId, log.id),
          orderBy: [exerciseSetLogs.roundNumber, exerciseSetLogs.setNumber],
        });

        return {
          ...log,
          sets: sets.map((set) => ({
            ...set,
            weight: parseDecimal(set.weight),
          })),
        };
      })
    );

    return logsWithSets;
  }

  async getExerciseLogsForPlanDayExercises(planDayExerciseIds: number[]) {
    const logs = await this.db.query.exerciseLogs.findMany({
      where: inArray(exerciseLogs.planDayExerciseId, planDayExerciseIds),
      orderBy: [desc(exerciseLogs.createdAt)],
    });

    // Get sets for each log
    const logsWithSets = await Promise.all(
      logs.map(async (log) => {
        const sets = await this.db.query.exerciseSetLogs.findMany({
          where: eq(exerciseSetLogs.exerciseLogId, log.id),
          orderBy: [exerciseSetLogs.roundNumber, exerciseSetLogs.setNumber],
        });

        return {
          ...log,
          sets: sets.map((set) => ({
            ...set,
            weight: parseDecimal(set.weight),
          })),
        };
      })
    );

    return logsWithSets;
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

    // Get sets for all logs efficiently
    const logIds = logs.map((log) => log.id);
    const setsByLogId = await this.getSetsForExerciseLogs(logIds);

    return logs.map((log) => ({
      ...log,
      sets: setsByLogId[log.id] || [],
    }));
  }

  async getExerciseSetLogs(exerciseLogId: number) {
    const sets = await this.db.query.exerciseSetLogs.findMany({
      where: eq(exerciseSetLogs.exerciseLogId, exerciseLogId),
      orderBy: [exerciseSetLogs.roundNumber, exerciseSetLogs.setNumber],
    });

    return sets.map((set) => ({
      ...set,
      weight: parseDecimal(set.weight),
    }));
  }

  // Helper method to get sets for multiple exercise logs
  private async getSetsForExerciseLogs(exerciseLogIds: number[]) {
    if (exerciseLogIds.length === 0) return {};

    const sets = await this.db.query.exerciseSetLogs.findMany({
      where: inArray(exerciseSetLogs.exerciseLogId, exerciseLogIds),
      orderBy: [
        exerciseSetLogs.exerciseLogId,
        exerciseSetLogs.roundNumber,
        exerciseSetLogs.setNumber,
      ],
    });

    // Group sets by exercise log ID
    const setsByLogId: Record<number, ExerciseSetLog[]> = {};
    sets.forEach((set) => {
      if (!setsByLogId[set.exerciseLogId]) {
        setsByLogId[set.exerciseLogId] = [];
      }
      setsByLogId[set.exerciseLogId].push({
        ...set,
        weight: parseDecimal(set.weight),
      });
    });

    return setsByLogId;
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
        skippedExercises: [],
        skippedBlocks: [],
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

  // ==================== SKIP TRACKING ====================

  async addSkippedExercise(workoutId: number, planDayExerciseId: number) {
    const workoutLog = await this.getOrCreateWorkoutLog(workoutId);

    const currentSkipped = workoutLog.skippedExercises || [];
    const currentCompleted = workoutLog.completedExercises || [];
    
    // Remove from completed if it was there, and add to skipped
    const updatedCompleted = currentCompleted.filter(id => id !== planDayExerciseId);
    if (!currentSkipped.includes(planDayExerciseId)) {
      const updatedSkipped = [...currentSkipped, planDayExerciseId];

      await this.updateWorkoutLog(workoutId, {
        skippedExercises: updatedSkipped,
        completedExercises: updatedCompleted,
      });
    }

    // Also mark the exercise itself as skipped in the planDayExercises table
    await this.db
      .update(planDayExercises)
      .set({ isSkipped: true, updatedAt: new Date() })
      .where(eq(planDayExercises.id, planDayExerciseId));

    return this.getLatestWorkoutLogForWorkout(workoutId);
  }

  async addSkippedBlock(workoutId: number, workoutBlockId: number) {
    const workoutLog = await this.getOrCreateWorkoutLog(workoutId);

    const currentSkipped = workoutLog.skippedBlocks || [];
    const currentCompleted = workoutLog.completedBlocks || [];
    
    // Remove from completed if it was there, and add to skipped
    const updatedCompleted = currentCompleted.filter(id => id !== workoutBlockId);
    if (!currentSkipped.includes(workoutBlockId)) {
      const updatedSkipped = [...currentSkipped, workoutBlockId];

      await this.updateWorkoutLog(workoutId, {
        skippedBlocks: updatedSkipped,
        completedBlocks: updatedCompleted,
      });
    }

    // Mark all exercises in the block as skipped
    await this.db
      .update(planDayExercises)
      .set({ isSkipped: true, updatedAt: new Date() })
      .where(eq(planDayExercises.workoutBlockId, workoutBlockId));

    // Also add all exercises in this block to skippedExercises array
    const blockExercises = await this.db.query.planDayExercises.findMany({
      where: eq(planDayExercises.workoutBlockId, workoutBlockId),
    });

    const exerciseIds = blockExercises.map(ex => ex.id);
    const currentSkippedExercises = workoutLog.skippedExercises || [];
    const currentCompletedExercises = workoutLog.completedExercises || [];
    
    // Remove block exercises from completed and add to skipped
    const updatedCompletedExercises = currentCompletedExercises.filter(
      id => !exerciseIds.includes(id)
    );
    const updatedSkippedExercises = [...new Set([...currentSkippedExercises, ...exerciseIds])];

    await this.updateWorkoutLog(workoutId, {
      skippedExercises: updatedSkippedExercises,
      completedExercises: updatedCompletedExercises,
    });

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

    const completedExercises = workoutLog.completedExercises?.length || 0;
    const skippedExercises = workoutLog.skippedExercises?.length || 0;
    const processedExercises = completedExercises + skippedExercises;

    const completedBlocks = workoutLog.completedBlocks?.length || 0;
    const skippedBlocks = workoutLog.skippedBlocks?.length || 0;
    const processedBlocks = completedBlocks + skippedBlocks;

    return {
      workoutLog,
      progress: {
        exercises: {
          completed: completedExercises,
          skipped: skippedExercises,
          total: totalExercises,
          processed: processedExercises,
          percentage:
            totalExercises > 0
              ? Math.round((processedExercises / totalExercises) * 100)
              : 0,
        },
        blocks: {
          completed: completedBlocks,
          skipped: skippedBlocks,
          total: totalBlocks,
          processed: processedBlocks,
          percentage:
            totalBlocks > 0
              ? Math.round((processedBlocks / totalBlocks) * 100)
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

    // Get sets for all logs efficiently
    const logIds = logs.map((log) => log.id);
    const setsByLogId = await this.getSetsForExerciseLogs(logIds);

    return logs.map((log) => ({
      ...log,
      sets: setsByLogId[log.id] || [],
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
    const skippedExercises = workoutLog.skippedExercises || [];
    const processedExercises = [...completedExercises, ...skippedExercises];
    
    const isComplete = totalExerciseIds.every((id) =>
      processedExercises.includes(id)
    );

    if (isComplete !== workoutLog.isComplete) {
      await this.updateWorkoutLog(workoutId, {
        isComplete,
      });
    }
  }

  async markWorkoutDayComplete(
    planDayId: number,
    completionData?: {
      totalTimeSeconds?: number;
      exercisesCompleted?: number;
      blocksCompleted?: number;
      notes?: string;
    }
  ): Promise<void> {
    console.log('🐛 markWorkoutDayComplete called:', {
      planDayId,
      completionData,
      hasCompletionData: !!completionData,
      totalTimeSeconds: completionData?.totalTimeSeconds,
      typeOfTotalTime: typeof completionData?.totalTimeSeconds
    });
    // First, get the plan day to find the workout ID
    const planDay = await this.db
      .select()
      .from(planDays)
      .where(eq(planDays.id, planDayId))
      .limit(1);

    if (planDay.length === 0) {
      throw new Error("Plan day not found");
    }

    const workoutId = planDay[0].workoutId;

    // Mark the plan day as complete
    await this.db
      .update(planDays)
      .set({ isComplete: true, updatedAt: new Date() })
      .where(eq(planDays.id, planDayId));

    // If completion data is provided, create/update plan day log
    if (completionData) {
      const logData = {
        planDayId,
        totalTimeSeconds: completionData.totalTimeSeconds,
        exercisesCompleted: completionData.exercisesCompleted,
        blocksCompleted: completionData.blocksCompleted,
        isComplete: true,
        notes: completionData.notes,
      };

      // Try to find existing plan day log first
      const existingLog = await this.db
        .select()
        .from(planDayLogs)
        .where(eq(planDayLogs.planDayId, planDayId))
        .limit(1);

      if (existingLog.length > 0) {
        // Update existing log
        await this.db
          .update(planDayLogs)
          .set({ ...logData, updatedAt: new Date() })
          .where(eq(planDayLogs.id, existingLog[0].id));
      } else {
        // Create new log
        await this.db.insert(planDayLogs).values(logData);
      }
    }

    // Track workout completion analytics for this plan day
    try {
      const workout = await this.db.query.workouts.findFirst({
        where: eq(workouts.id, workoutId),
      });

      if (workout && workout.userId) {
        // Get user UUID for analytics
        const user = await this.db.query.users.findFirst({
          where: eq(users.id, workout.userId),
        });

        if (user?.uuid) {
          // Calculate actual completion percentage based on exercises completed
          const totalExercises = await this.getTotalExercisesForPlanDay(planDayId);
          const completedExercises = completionData?.exercisesCompleted || 0;
          const completion_percentage = totalExercises > 0
            ? Math.min(100, Math.round((completedExercises / totalExercises) * 100))
            : 100;

          const duration_ms = (completionData?.totalTimeSeconds || 0) * 1000;

          console.log('🐛 Analytics data being sent:', {
            workout_id: workoutId,
            plan_day_id: planDayId,
            duration_ms,
            completion_percentage,
            originalTotalTimeSeconds: completionData?.totalTimeSeconds
          });

          await eventTrackingService.trackWorkoutCompleted(user.uuid, {
            workout_id: workoutId,
            plan_day_id: planDayId,
            duration_ms,
            completion_percentage,
          });
        }
      }
    } catch (error) {
      console.error('Failed to track workout completion analytics:', error);
    }

    // Check if all plan days in the workout are now complete
    const allPlanDays = await this.db
      .select()
      .from(planDays)
      .where(eq(planDays.workoutId, workoutId));

    const allComplete = allPlanDays.every(day => day.isComplete);

    if (allComplete) {
      // Mark the entire workout as complete
      await this.db
        .update(workouts)
        .set({ completed: true, updatedAt: new Date() })
        .where(eq(workouts.id, workoutId));

      // Create/update workout log to mark as complete
      const workoutLog = await this.getOrCreateWorkoutLog(workoutId);
      
      // Calculate total time from all plan day logs
      const planDayLogs = await this.db
        .select()
        .from(planDayLogs)
        .where(inArray(planDayLogs.planDayId, allPlanDays.map(day => day.id)));

      const totalTimeSeconds = planDayLogs.reduce((total, log) => {
        return total + (log.totalTimeSeconds || 0);
      }, 0);

      const totalTimeMinutes = Math.round(totalTimeSeconds / 60);

      await this.updateWorkoutLog(workoutId, {
        totalTimeMinutes,
        daysCompleted: allPlanDays.length,
        totalDays: allPlanDays.length,
        isComplete: true,
      });
    }
  }
}

export const logsService = new LogsService();

import {
  exerciseLogs,
  InsertWorkoutLog,
  workoutLogs,
  UpdateWorkoutLog,
} from "@/models";
import { BaseService } from "./base.service";
import { InsertExerciseLog } from "@/models";
import { eq, and } from "drizzle-orm";

export class LogsService extends BaseService {
  async createExerciseLog(data: InsertExerciseLog) {
    const [createdExerciseLog] = await this.db
      .insert(exerciseLogs)
      .values(data)
      .returning();
    return createdExerciseLog;
  }

  async getExerciseLogsForPlanDay(planDayId: number) {
    const result = await this.db.query.exerciseLogs.findMany({
      where: eq(exerciseLogs.planDayExerciseId, planDayId),
    });
    return result;
  }

  async getExerciseLogsForPlanDayExercises(planDayExerciseIds: number[]) {
    const result = await this.db.query.exerciseLogs.findMany({
      where: (exerciseLogs, { inArray }) =>
        inArray(exerciseLogs.planDayExerciseId, planDayExerciseIds),
    });
    return result;
  }

  async createWorkoutLog(data: InsertWorkoutLog) {
    const [createdWorkoutLog] = await this.db
      .insert(workoutLogs)
      .values(data)
      .returning();
    return createdWorkoutLog;
  }

  async getWorkoutLogForWorkout(workoutId: number) {
    const result = await this.db.query.workoutLogs.findFirst({
      where: eq(workoutLogs.workoutId, workoutId),
      orderBy: (workoutLogs, { desc }) => [desc(workoutLogs.createdAt)],
    });
    return result;
  }

  async updateWorkoutLog(workoutId: number, data: UpdateWorkoutLog) {
    // Get existing workout log
    const existingLog = await this.getWorkoutLogForWorkout(workoutId);

    if (!existingLog) {
      throw new Error("Workout log not found");
    }

    // Merge data with existing values
    const updateData: UpdateWorkoutLog = {
      isComplete: data.isComplete ?? existingLog.isComplete,
      totalTimeTaken:
        data.totalTimeTaken !== undefined
          ? (existingLog.totalTimeTaken ?? 0) + data.totalTimeTaken
          : existingLog.totalTimeTaken ?? undefined,
      notes: data.notes
        ? existingLog.notes
          ? `${existingLog.notes}\n${data.notes}`
          : data.notes
        : existingLog.notes ?? undefined,
    };

    const [updatedWorkoutLog] = await this.db
      .update(workoutLogs)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(workoutLogs.id, existingLog.id))
      .returning();

    return updatedWorkoutLog;
  }

  async getOrCreateWorkoutLog(workoutId: number) {
    let workoutLog = await this.getWorkoutLogForWorkout(workoutId);

    if (!workoutLog) {
      workoutLog = await this.createWorkoutLog({
        workoutId,
        isComplete: false,
        totalTimeTaken: 0,
        completedExercises: [],
        notes: "",
      });
    }

    return workoutLog;
  }

  async getWorkoutLogsForWorkout(workoutId: number) {
    const result = await this.db.query.workoutLogs.findMany({
      where: eq(workoutLogs.workoutId, workoutId),
      orderBy: (workoutLogs, { desc }) => [desc(workoutLogs.createdAt)],
    });
    return result;
  }

  async getCompletedExercisesCount(workoutId: number) {
    const workoutLog = await this.getWorkoutLogForWorkout(workoutId);
    return workoutLog?.completedExercises?.length || 0;
  }

  async addCompletedExercise(workoutId: number, planDayExerciseId: number) {
    const workoutLog = await this.getOrCreateWorkoutLog(workoutId);

    const currentCompleted = workoutLog.completedExercises || [];
    if (!currentCompleted.includes(planDayExerciseId)) {
      const updatedCompleted = [...currentCompleted, planDayExerciseId];

      // Check if all exercises for this workout are now completed
      // We need to get the total number of exercises for this workout to determine completion
      const isWorkoutComplete = await this.checkWorkoutCompletion(
        workoutId,
        updatedCompleted
      );

      await this.updateWorkoutLog(workoutId, {
        isComplete: isWorkoutComplete,
      });

      // Update the completedExercises array in the workout log
      await this.db
        .update(workoutLogs)
        .set({
          completedExercises: updatedCompleted,
          updatedAt: new Date(),
        })
        .where(eq(workoutLogs.id, workoutLog.id));
    }

    return this.getWorkoutLogForWorkout(workoutId);
  }

  async getCompletedExercisesForWorkout(workoutId: number) {
    const workoutLog = await this.getWorkoutLogForWorkout(workoutId);
    return workoutLog?.completedExercises || [];
  }

  // Helper method to check if all exercises in a workout are completed
  private async checkWorkoutCompletion(
    workoutId: number,
    completedExerciseIds: number[]
  ): Promise<boolean> {
    // This would need to query the workout structure to get total exercises
    // For now, we'll return false and let the frontend determine completion
    // You might want to implement this based on your workout structure
    return false;
  }

  // New method to mark workout as complete when all exercises are done
  async markWorkoutComplete(
    workoutId: number,
    totalExerciseIds: number[]
  ): Promise<void> {
    const workoutLog = await this.getWorkoutLogForWorkout(workoutId);
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

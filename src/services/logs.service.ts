import { exerciseLogs } from "@/models";
import { BaseService } from "./base.service";
import { InsertExerciseLog } from "@/models";
import { eq } from "drizzle-orm";

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
}

export const logsService = new LogsService();

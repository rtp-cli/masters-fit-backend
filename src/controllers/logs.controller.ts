import {
  insertExerciseLogSchema,
  insertBlockLogSchema,
  insertPlanDayLogSchema,
  insertWorkoutLogSchema,
  updateExerciseLogSchema,
  updateBlockLogSchema,
  updatePlanDayLogSchema,
  updateWorkoutLogSchema,
  ExerciseLog,
} from "@/models";
import { logsService } from "@/services";
import {
  ApiResponse,
  ExerciseLogsResponse,
  ExerciseLogResponse,
  BlockLogsResponse,
  BlockLogResponse,
  PlanDayLogsResponse,
  PlanDayLogResponse,
  WorkoutLogResponse,
  WorkoutLogOrNullResponse,
  WorkoutLogsResponse,
  WorkoutProgressResponse,
  PlanDayProgressResponse,
  CompletedExercisesResponse,
} from "@/types";
import {
  Body,
  Controller,
  Post,
  Route,
  Response,
  SuccessResponse,
  Tags,
  Get,
  Path,
  Example,
  Security,
  Put,
} from "@tsoa/runtime";
import { logger } from "@/utils/logger";

@Route("logs")
@Tags("Logs")
@Security("bearerAuth")
export class LogsController extends Controller {
  // ==================== EXERCISE LOGS ====================

  /**
   * Create a new exercise log entry
   */
  @Post("/exercise")
  public async createExerciseLog(
    @Body()
    requestBody: {
      planDayExerciseId: number;
      setsCompleted?: number;
      repsCompleted?: number;
      roundsCompleted?: number;
      weightUsed?: number;
      durationCompleted?: number;
      restTimeTaken?: number;
      timeTaken?: number;
      isComplete?: boolean;
      isSkipped?: boolean;
      notes?: string;
      difficulty?: string;
      rating?: number;
    }
  ): Promise<ExerciseLog> {
    try {
      const exerciseLog = await logsService.createExerciseLog(requestBody);
      return exerciseLog;
    } catch (error) {
      logger.error("Error creating exercise log", error as Error, {
        operation: "createExerciseLog",
      });
      throw error;
    }
  }

  /**
   * Update exercise log
   * @param exerciseLogId Exercise log ID
   * @param requestBody Update data
   */
  @Put("/exercise/{exerciseLogId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updateExerciseLog(
    @Path() exerciseLogId: number,
    @Body() requestBody: any
  ): Promise<ExerciseLogResponse> {
    const validatedData = updateExerciseLogSchema.parse(requestBody);
    const log = await logsService.updateExerciseLog(
      exerciseLogId,
      validatedData
    );
    return {
      success: true,
      log,
    };
  }

  /**
   * Get exercise log by ID
   * @param exerciseLogId Exercise log ID
   */
  @Get("/exercise/{exerciseLogId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getExerciseLog(
    @Path() exerciseLogId: number
  ): Promise<ExerciseLogResponse> {
    const log = await logsService.getExerciseLog(exerciseLogId);
    if (!log) {
      this.setStatus(404);
      return {
        success: false,
        error: "Exercise log not found",
        log: null as any,
      };
    }
    return {
      success: true,
      log,
    };
  }

  /**
   * Get exercise logs for a plan day exercise
   * @param planDayExerciseId Plan day exercise ID
   */
  @Get("/exercise/plan-day-exercise/{planDayExerciseId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getExerciseLogsForPlanDayExercise(
    @Path() planDayExerciseId: number
  ): Promise<ExerciseLogsResponse> {
    const exerciseLogs =
      await logsService.getExerciseLogsForPlanDayExercise(planDayExerciseId);
    return {
      success: true,
      logs: exerciseLogs,
    };
  }

  /**
   * Get exercise logs for a workout block
   * @param workoutBlockId Workout block ID
   */
  @Get("/exercise/block/{workoutBlockId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getExerciseLogsForWorkoutBlock(
    @Path() workoutBlockId: number
  ): Promise<ExerciseLogsResponse> {
    const exerciseLogs =
      await logsService.getExerciseLogsForWorkoutBlock(workoutBlockId);
    return {
      success: true,
      logs: exerciseLogs,
    };
  }

  /**
   * Get exercise logs for a plan day (legacy endpoint)
   * @param planDayId Plan day ID
   */
  @Get("/exercise/plan-day/{planDayId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getExerciseLogsForPlanDay(
    @Path() planDayId: number
  ): Promise<ExerciseLogsResponse> {
    const exerciseLogs = await logsService.getExerciseLogsForPlanDay(planDayId);
    return {
      success: true,
      logs: exerciseLogs,
    };
  }

  // ==================== BLOCK LOGS ====================

  /**
   * Create block log
   * @param requestBody Block log data
   */
  @Post("/block")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createBlockLog(
    @Body() requestBody: any
  ): Promise<BlockLogResponse> {
    const validatedData = insertBlockLogSchema.parse(requestBody);
    const log = await logsService.createBlockLog(validatedData);
    return {
      success: true,
      log,
    };
  }

  /**
   * Update block log
   * @param blockLogId Block log ID
   * @param requestBody Update data
   */
  @Put("/block/{blockLogId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updateBlockLog(
    @Path() blockLogId: number,
    @Body() requestBody: any
  ): Promise<BlockLogResponse> {
    const validatedData = updateBlockLogSchema.parse(requestBody);
    const log = await logsService.updateBlockLog(blockLogId, validatedData);
    return {
      success: true,
      log,
    };
  }

  /**
   * Get block log by ID
   * @param blockLogId Block log ID
   */
  @Get("/block/{blockLogId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getBlockLog(
    @Path() blockLogId: number
  ): Promise<BlockLogResponse> {
    const log = await logsService.getBlockLog(blockLogId);
    if (!log) {
      this.setStatus(404);
      return {
        success: false,
        error: "Block log not found",
        log: null as any,
      };
    }
    return {
      success: true,
      log,
    };
  }

  /**
   * Get block logs for a workout block
   * @param workoutBlockId Workout block ID
   */
  @Get("/block/workout-block/{workoutBlockId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getBlockLogsForWorkoutBlock(
    @Path() workoutBlockId: number
  ): Promise<BlockLogsResponse> {
    const blockLogs =
      await logsService.getBlockLogsForWorkoutBlock(workoutBlockId);
    return {
      success: true,
      logs: blockLogs,
    };
  }

  /**
   * Get latest block log for a workout block
   * @param workoutBlockId Workout block ID
   */
  @Get("/block/workout-block/{workoutBlockId}/latest")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getLatestBlockLogForWorkoutBlock(
    @Path() workoutBlockId: number
  ): Promise<BlockLogResponse> {
    const log =
      await logsService.getLatestBlockLogForWorkoutBlock(workoutBlockId);
    if (!log) {
      this.setStatus(404);
      return {
        success: false,
        error: "Block log not found",
        log: null as any,
      };
    }
    return {
      success: true,
      log,
    };
  }

  /**
   * Get block logs for a plan day
   * @param planDayId Plan day ID
   */
  @Get("/block/plan-day/{planDayId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getBlockLogsForPlanDay(
    @Path() planDayId: number
  ): Promise<BlockLogsResponse> {
    const blockLogs = await logsService.getBlockLogsForPlanDay(planDayId);
    return {
      success: true,
      logs: blockLogs,
    };
  }

  // ==================== PLAN DAY LOGS ====================

  /**
   * Create plan day log
   * @param requestBody Plan day log data
   */
  @Post("/plan-day")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createPlanDayLog(
    @Body() requestBody: any
  ): Promise<PlanDayLogResponse> {
    const validatedData = insertPlanDayLogSchema.parse(requestBody);
    const log = await logsService.createPlanDayLog(validatedData);
    return {
      success: true,
      log,
    };
  }

  /**
   * Update plan day log
   * @param planDayLogId Plan day log ID
   * @param requestBody Update data
   */
  @Put("/plan-day/{planDayLogId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updatePlanDayLog(
    @Path() planDayLogId: number,
    @Body() requestBody: any
  ): Promise<PlanDayLogResponse> {
    const validatedData = updatePlanDayLogSchema.parse(requestBody);
    const log = await logsService.updatePlanDayLog(planDayLogId, validatedData);
    return {
      success: true,
      log,
    };
  }

  /**
   * Get plan day log by ID
   * @param planDayLogId Plan day log ID
   */
  @Get("/plan-day/{planDayLogId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getPlanDayLog(
    @Path() planDayLogId: number
  ): Promise<PlanDayLogResponse> {
    const log = await logsService.getPlanDayLog(planDayLogId);
    if (!log) {
      this.setStatus(404);
      return {
        success: false,
        error: "Plan day log not found",
        log: null as any,
      };
    }
    return {
      success: true,
      log,
    };
  }

  /**
   * Get plan day logs for a plan day
   * @param planDayId Plan day ID
   */
  @Get("/plan-day/plan-day/{planDayId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getPlanDayLogsForPlanDay(
    @Path() planDayId: number
  ): Promise<PlanDayLogsResponse> {
    const planDayLogs = await logsService.getPlanDayLogsForPlanDay(planDayId);
    return {
      success: true,
      logs: planDayLogs,
    };
  }

  /**
   * Get latest plan day log for a plan day
   * @param planDayId Plan day ID
   */
  @Get("/plan-day/plan-day/{planDayId}/latest")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getLatestPlanDayLogForPlanDay(
    @Path() planDayId: number
  ): Promise<PlanDayLogResponse> {
    const log = await logsService.getLatestPlanDayLogForPlanDay(planDayId);
    if (!log) {
      this.setStatus(404);
      return {
        success: false,
        error: "Plan day log not found",
        log: null as any,
      };
    }
    return {
      success: true,
      log,
    };
  }

  /**
   * Get plan day logs for a workout
   * @param workoutId Workout ID
   */
  @Get("/plan-day/workout/{workoutId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getPlanDayLogsForWorkout(
    @Path() workoutId: number
  ): Promise<PlanDayLogsResponse> {
    const planDayLogs = await logsService.getPlanDayLogsForWorkout(workoutId);
    return {
      success: true,
      logs: planDayLogs,
    };
  }

  // ==================== WORKOUT LOGS ====================

  /**
   * Create workout log
   * @param requestBody Workout log data
   */
  @Post("/workout")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createWorkoutLog(
    @Body() requestBody: any
  ): Promise<WorkoutLogResponse> {
    const validatedData = insertWorkoutLogSchema.parse(requestBody);
    const log = await logsService.createWorkoutLog(validatedData);
    return {
      success: true,
      log,
    };
  }

  /**
   * Get or create workout log for a workout
   * @param workoutId Workout ID
   */
  @Get("/workout/{workoutId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getOrCreateWorkoutLog(
    @Path() workoutId: number
  ): Promise<WorkoutLogResponse> {
    const log = await logsService.getOrCreateWorkoutLog(workoutId);
    return {
      success: true,
      log,
    };
  }

  /**
   * Get existing workout log for a workout (without creating)
   * @param workoutId Workout ID
   */
  @Get("/workout/{workoutId}/existing")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getExistingWorkoutLog(
    @Path() workoutId: number
  ): Promise<WorkoutLogOrNullResponse> {
    const log = await logsService.getLatestWorkoutLogForWorkout(workoutId);
    return {
      success: true,
      log: log || null,
    };
  }

  /**
   * Update workout log
   * @param workoutId Workout ID
   * @param requestBody Update data
   */
  @Put("/workout/{workoutId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updateWorkoutLog(
    @Path() workoutId: number,
    @Body() requestBody: any
  ): Promise<WorkoutLogResponse> {
    const validatedData = updateWorkoutLogSchema.parse(requestBody);
    const log = await logsService.updateWorkoutLog(workoutId, validatedData);
    return {
      success: true,
      log,
    };
  }

  /**
   * Get all workout logs for a workout
   * @param workoutId Workout ID
   */
  @Get("/workout/{workoutId}/all")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWorkoutLogsForWorkout(
    @Path() workoutId: number
  ): Promise<WorkoutLogsResponse> {
    const logs = await logsService.getWorkoutLogsForWorkout(workoutId);
    return {
      success: true,
      logs,
    };
  }

  // ==================== PROGRESS TRACKING ====================

  /**
   * Get workout progress
   * @param workoutId Workout ID
   */
  @Get("/workout/{workoutId}/progress")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWorkoutProgress(
    @Path() workoutId: number
  ): Promise<WorkoutProgressResponse> {
    const progress = await logsService.getWorkoutProgress(workoutId);
    return {
      success: true,
      progress,
    };
  }

  /**
   * Get plan day progress
   * @param planDayId Plan day ID
   */
  @Get("/plan-day/{planDayId}/progress")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getPlanDayProgress(
    @Path() planDayId: number
  ): Promise<PlanDayProgressResponse> {
    const progress = await logsService.getPlanDayProgress(planDayId);
    return {
      success: true,
      progress,
    };
  }

  // ==================== COMPLETION TRACKING ====================

  /**
   * Add completed exercise to workout
   * @param workoutId Workout ID
   * @param planDayExerciseId Plan day exercise ID
   */
  @Post("/workout/{workoutId}/exercise/{planDayExerciseId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async addCompletedExercise(
    @Path() workoutId: number,
    @Path() planDayExerciseId: number
  ): Promise<WorkoutLogResponse> {
    const log = await logsService.addCompletedExercise(
      workoutId,
      planDayExerciseId
    );
    return {
      success: true,
      log: log!,
    };
  }

  /**
   * Add completed block to workout
   * @param workoutId Workout ID
   * @param workoutBlockId Workout block ID
   */
  @Post("/workout/{workoutId}/block/{workoutBlockId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async addCompletedBlock(
    @Path() workoutId: number,
    @Path() workoutBlockId: number
  ): Promise<WorkoutLogResponse> {
    const log = await logsService.addCompletedBlock(workoutId, workoutBlockId);
    return {
      success: true,
      log: log!,
    };
  }

  /**
   * Add completed day to workout
   * @param workoutId Workout ID
   * @param planDayId Plan day ID
   */
  @Post("/workout/{workoutId}/day/{planDayId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async addCompletedDay(
    @Path() workoutId: number,
    @Path() planDayId: number
  ): Promise<WorkoutLogResponse> {
    const log = await logsService.addCompletedDay(workoutId, planDayId);
    return {
      success: true,
      log: log!,
    };
  }

  // ==================== LEGACY ENDPOINTS (for backward compatibility) ====================

  /**
   * Get completed exercises for a workout
   * @param workoutId Workout ID
   */
  @Get("/workout/{workoutId}/completed")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getCompletedExercisesForWorkout(
    @Path() workoutId: number
  ): Promise<CompletedExercisesResponse> {
    const completedExercises =
      await logsService.getCompletedExercisesForWorkout(workoutId);
    const count = await logsService.getCompletedExercisesCount(workoutId);
    return {
      success: true,
      completedExercises,
      count,
    };
  }

  /**
   * Mark workout as complete
   * @param workoutId Workout ID
   * @param requestBody Total exercise IDs
   */
  @Post("/workout/{workoutId}/complete")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async markWorkoutComplete(
    @Path() workoutId: number,
    @Body() requestBody: { totalExerciseIds: number[] }
  ): Promise<WorkoutLogResponse> {
    await logsService.markWorkoutComplete(
      workoutId,
      requestBody.totalExerciseIds
    );
    const log = await logsService.getLatestWorkoutLogForWorkout(workoutId);
    return {
      success: true,
      log: log!,
    };
  }

  /**
   * Mark workout day as complete
   * @param planDayId Plan day ID
   */
  @Post("/workout/day/{planDayId}/complete")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async markWorkoutDayComplete(
    @Path() planDayId: number
  ): Promise<ApiResponse> {
    await logsService.markWorkoutDayComplete(planDayId);
    return {
      success: true,
    };
  }
}

export const logsController = new LogsController();

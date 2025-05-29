import {
  insertExerciseLogSchema,
  insertWorkoutLogSchema,
  updateWorkoutLogSchema,
} from "@/models";
import { logsService } from "@/services";
import {
  ApiResponse,
  ExerciseLogsResponse,
  ExerciseLogResponse,
  WorkoutLogResponse,
  WorkoutLogOrNullResponse,
  WorkoutLogsResponse,
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

@Route("logs")
@Tags("Logs")
@Security("bearerAuth")
export class LogsController extends Controller {
  /**
   * Create exercise log
   * @param requestBody Exercise log data
   */
  @Post("/exercise")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createExerciseLog(
    @Body() requestBody: any
  ): Promise<ExerciseLogResponse> {
    const validatedData = insertExerciseLogSchema.parse(requestBody);
    const log = await logsService.createExerciseLog(validatedData);
    return {
      success: true,
      log,
    };
  }

  /**
   * Get exercise logs for a plan day
   * @param planDayId Plan day ID
   */
  @Get("/exercise/{planDayId}")
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
    const log = await logsService.getWorkoutLogForWorkout(workoutId);
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
   * Mark workout as complete based on all exercises being completed
   * @param workoutId Workout ID
   * @param requestBody Array of all exercise IDs for the workout
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
    const log = await logsService.getWorkoutLogForWorkout(workoutId);
    return {
      success: true,
      log: log!,
    };
  }
}

export const logsController = new LogsController();

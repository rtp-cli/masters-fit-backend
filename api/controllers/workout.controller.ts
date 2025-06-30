import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Put,
  Route,
  Response,
  SuccessResponse,
  Tags,
  Example,
  Security,
} from "@tsoa/runtime";
import {
  WorkoutsResponse,
  WorkoutResponse,
  PlanDayResponse,
  WorkoutBlockExerciseResponse,
} from "@/types/workout/responses";
import {
  CreateWorkoutRequest,
  CreatePlanDayRequest,
  CreatePlanDayExerciseRequest,
} from "@/types/workout/requests";
import { ApiResponse } from "@/types/common/responses";
import { workoutService } from "@/services";
import { InsertWorkout, InsertPlanDay, InsertPlanDayExercise } from "@/models";

@Route("workouts")
@Tags("Workouts")
@Security("bearerAuth")
export class WorkoutController extends Controller {
  /**
   * Get all workouts for a user
   */
  @Get("/{userId}")
  @Response<WorkoutsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getUserWorkouts(
    @Path() userId: number
  ): Promise<WorkoutsResponse> {
    const workouts = await workoutService.getUserWorkouts(userId);
    return {
      success: true,
      workouts,
    };
  }

  /**
   * Get active workouts for a user
   */
  @Get("/{userId}/active")
  @Response<WorkoutsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getActiveWorkouts(
    @Path() userId: number
  ): Promise<WorkoutsResponse> {
    const workouts = await workoutService.getActiveWorkouts(userId);
    return {
      success: true,
      workouts,
    };
  }

  /**
   * Create new workout
   * @param requestBody Workout data
   */
  @Post("/{userId}")
  @Response<WorkoutResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createWorkout(
    @Path() userId: number,
    @Body() requestBody: CreateWorkoutRequest
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.createWorkout({
      ...requestBody,
      userId,
      isActive: true,
      completed: false,
    });
    return {
      success: true,
      workout: {
        ...workout,
        planDays: [],
        created_at: workout.createdAt,
        updated_at: workout.updatedAt,
      },
    };
  }

  /**
   * Update workout
   * @param id Workout ID
   * @param requestBody Updated workout data
   */
  @Put("/{id}")
  @Response<WorkoutResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updateWorkout(
    @Path() id: number,
    @Body() requestBody: Partial<InsertWorkout>
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.updateWorkout(id, requestBody);
    return {
      success: true,
      workout,
    };
  }

  /**
   * Create new plan day
   * @param workoutId Workout ID
   * @param requestBody Plan day data
   */
  @Post("/{workoutId}/days")
  @Response<PlanDayResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createPlanDay(
    @Path() workoutId: number,
    @Body() requestBody: CreatePlanDayRequest
  ): Promise<PlanDayResponse> {
    const planDay = await workoutService.createPlanDay({
      ...requestBody,
      workoutId,
    });
    return {
      success: true,
      planDay,
    };
  }

  /**
   * Create plan day exercise
   * @param planDayId Plan day ID
   * @param requestBody Exercise data
   */
  @Post("/plan-day/{planDayId}/exercise")
  @Response<WorkoutBlockExerciseResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createPlanDayExercise(
    @Path() planDayId: number,
    @Body() requestBody: CreatePlanDayExerciseRequest
  ): Promise<WorkoutBlockExerciseResponse> {
    const exercise = await workoutService.createPlanDayExercise({
      ...requestBody,
    });
    return {
      success: true,
      workoutBlockExercise: exercise,
    };
  }

  /**
   * Update plan day exercise
   * @param id Exercise ID
   * @param requestBody Updated exercise data
   */
  @Put("/exercise/{id}")
  @Response<WorkoutBlockExerciseResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updatePlanDayExercise(
    @Path() id: number,
    @Body() requestBody: Partial<InsertPlanDayExercise>
  ): Promise<WorkoutBlockExerciseResponse> {
    const exercise = await workoutService.updatePlanDayExercise(
      id,
      requestBody
    );
    return {
      success: true,
      workoutBlockExercise: exercise,
    };
  }

  /**
   * Generate workout plan
   * @param userId User ID
   * @param requestBody Generation options including timezone
   */
  @Post("/{userId}/generate")
  @Response<WorkoutResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async generateWorkoutPlan(
    @Path() userId: number,
    @Body() requestBody?: { customFeedback?: string; timezone?: string }
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.generateWorkoutPlan(
      userId,
      requestBody?.customFeedback,
      requestBody?.timezone
    );
    return {
      success: true,
      workout,
    };
  }

  /**
   * Regenerate workout plan with custom preferences and feedback
   * @param userId User ID
   * @param requestBody Regeneration data
   */
  @Post("/{userId}/regenerate")
  @Response<WorkoutResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async regenerateWorkoutPlan(
    @Path() userId: number,
    @Body()
    requestBody: {
      customFeedback?: string;
      profileData?: {
        age?: number;
        height?: number;
        weight?: number;
        gender?: string;
        goals?: string[];
        limitations?: string[];
        fitnessLevel?: string;
        environment?: string[];
        equipment?: string[];
        workoutStyles?: string[];
        availableDays?: string[];
        workoutDuration?: number;
        intensityLevel?: number;
        medicalNotes?: string;
      };
    }
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.regenerateWorkoutPlan(
      userId,
      requestBody.customFeedback,
      requestBody.profileData
    );
    return {
      success: true,
      workout,
    };
  }

  /**
   * Fetch active workout
   * @param userId User ID
   */
  @Get("/{userId}/active-workout")
  @SuccessResponse(200, "Success")
  public async fetchActiveWorkout(
    @Path() userId: number
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.fetchActiveWorkout(userId);
    return {
      success: true,
      workout,
    };
  }

  /**
   * Regenerate a single day's workout
   * @param userId User ID
   * @param planDayId Plan day ID
   * @param requestBody Regeneration reason and optional styles
   */
  @Post("/{userId}/days/{planDayId}/regenerate")
  @Response<PlanDayResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async regenerateDailyWorkout(
    @Path() userId: number,
    @Path() planDayId: number,
    @Body()
    requestBody: {
      reason: string;
      styles?: string[];
      limitations?: string[];
    }
  ): Promise<PlanDayResponse> {
    const planDay = await workoutService.regenerateDailyWorkout(
      userId,
      planDayId,
      requestBody.reason,
      requestBody.styles
    );
    return {
      success: true,
      planDay,
    };
  }

  // Test endpoint to check active workouts (for debugging)
  @Get("/:userId/debug/active")
  async getActiveWorkoutsDebug(@Path() userId: string) {
    try {
      const activeWorkouts = await workoutService.getActiveWorkouts(
        parseInt(userId)
      );
      return {
        userId: parseInt(userId),
        activeWorkoutsCount: activeWorkouts.length,
        activeWorkouts: activeWorkouts.map((w) => ({
          id: w.id,
          name: w.name,
          isActive: w.isActive,
          createdAt: w.created_at,
        })),
      };
    } catch (error) {
      console.error("Error getting active workouts:", error);
      throw new Error("Failed to fetch active workouts");
    }
  }
}

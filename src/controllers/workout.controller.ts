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
  Security,
  Request,
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
import {
  workoutService,
  jobsService,
  notificationService,
  userService,
  subscriptionService,
  getLastTokenUsage,
  clearLastTokenUsage,
} from "@/services";
import { eventTrackingService } from "@/services/event-tracking.service";
import {
  InsertWorkout,
  InsertPlanDayExercise,
  WorkoutGenerationJobData,
  WorkoutRegenerationJobData,
  DailyRegenerationJobData,
  JobType,
} from "@/models";
import { logger } from "@/utils/logger";
import { workoutGenerationQueue } from "@/queues/workout-generation.queue";
import { AccessLevel } from "@/constants";

// Helper function to get client IP from request
function getClientIP(req: any): string | undefined {
  if (!req) return undefined;
  return (
    req.clientIP ||
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    undefined
  );
}

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
   * Replace exercise in plan day
   * @param id Plan day exercise ID
   * @param requestBody New exercise data
   */
  @Put("/exercise/{id}/replace")
  @Response<WorkoutBlockExerciseResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async replaceExercise(
    @Path() id: number,
    @Body() requestBody: { newExerciseId: number },
    @Request() request: any
  ): Promise<WorkoutBlockExerciseResponse> {
    // Get current exercise info before replacement for tracking
    const currentExercise = await workoutService.getPlanDayExercise(id);

    if (!currentExercise) {
      throw new Error("Exercise not found");
    }

    // Get the workout to get user info - we have workoutId from the enhanced getPlanDayExercise
    const workout = await workoutService.getWorkoutById(
      (currentExercise as any).workoutId
    );

    if (!workout) {
      throw new Error("Workout not found");
    }

    // Get user to get UUID for tracking
    const user = await userService.getUser(workout.userId);

    if (!user || !user.uuid) {
      throw new Error("User not found");
    }

    // Perform the replacement
    const newExercise = await workoutService.replaceExercise(
      id,
      requestBody.newExerciseId
    );

    // Track the exercise replacement
    try {
      const clientIP = getClientIP(request);
      await eventTrackingService.trackExerciseReplaced(
        user.uuid,
        {
          previous_exercise_id: currentExercise.exerciseId,
          previous_exercise_name:
            currentExercise.exercise?.name || "Unknown Exercise",
          current_exercise_id: newExercise.exerciseId,
          current_exercise_name:
            newExercise.exercise?.name || "Unknown Exercise",
          workout_id: (currentExercise as any).workoutId,
          plan_day_id: currentExercise.planDayId,
          workout_block_id: currentExercise.workoutBlockId,
        },
        clientIP
      );
    } catch (trackingError) {
      logger.error(
        "Failed to track exercise replacement",
        trackingError as Error,
        {
          userId: workout.userId,
          exerciseId: id,
          previousExerciseId: currentExercise.exerciseId,
          newExerciseId: requestBody.newExerciseId,
        }
      );
      // Don't throw here - replacement was successful, just tracking failed
    }

    return {
      success: true,
      workoutBlockExercise: newExercise,
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
    @Body()
    requestBody?: {
      customFeedback?: string;
      timezone?: string;
    },
    @Request() request?: any
  ): Promise<WorkoutResponse> {
    // Re-check limits in transaction (race condition protection)
    const accessLevel =
      await subscriptionService.getEffectiveAccessLevel(userId);
    const estimatedTokens = (request as any)?.estimatedTokens || 2000;

    // Block immediately if access is blocked
    if (accessLevel === AccessLevel.BLOCKED) {
      throw new Error("Subscription required for new workout generation");
    }

    // Only check trial limits for TRIAL users
    if (accessLevel === AccessLevel.TRIAL) {
      const limitCheck = await subscriptionService.checkTrialLimits(
        userId,
        "generation",
        estimatedTokens,
        "weekly"
      );
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.reason || "Trial limit exceeded");
      }
    }

    // Clear any previous token usage before generation
    clearLastTokenUsage(userId);

    const workout = await workoutService.generateWorkoutPlan(
      userId,
      requestBody?.customFeedback,
      requestBody?.timezone
    );

    // Get real token usage from generation (or fallback to estimate)
    const tokenUsage = getLastTokenUsage(userId);
    const actualTokensUsed = tokenUsage?.totalTokens || estimatedTokens;

    logger.info("Workout generation completed with token usage", {
      userId,
      operation: "generateWorkoutPlan",
      tokenUsage: tokenUsage || { estimated: estimatedTokens },
      actualTokensUsed,
    });

    // Increment usage after successful generation with real token count
    // Only increment for TRIAL users (UNLIMITED users don't need tracking)
    if (accessLevel === AccessLevel.TRIAL) {
      await subscriptionService.incrementTrialUsage(
        userId,
        "generation",
        actualTokensUsed,
        "weekly"
      );
    }

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
      threadId?: string;
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
    },
    @Request() request?: any
  ): Promise<WorkoutResponse> {
    // Re-check limits in transaction (race condition protection)
    const accessLevel =
      await subscriptionService.getEffectiveAccessLevel(userId);
    const estimatedTokens = (request as any)?.estimatedTokens || 2000;

    // Block immediately if access is blocked
    if (accessLevel === AccessLevel.BLOCKED) {
      throw new Error("Subscription required for workout regeneration");
    }

    // Only check trial limits for TRIAL users
    if (accessLevel === AccessLevel.TRIAL) {
      const limitCheck = await subscriptionService.checkTrialLimits(
        userId,
        "regeneration",
        estimatedTokens,
        "weekly"
      );
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.reason || "Trial limit exceeded");
      }
    }

    // Clear any previous token usage before regeneration
    clearLastTokenUsage(userId);

    const workout = await workoutService.regenerateWorkoutPlan(
      userId,
      requestBody.customFeedback,
      requestBody.profileData,
      requestBody.threadId
    );

    // Get real token usage from regeneration (or fallback to estimate)
    const tokenUsage = getLastTokenUsage(userId);
    const actualTokensUsed = tokenUsage?.totalTokens || estimatedTokens;

    logger.info("Workout regeneration completed with token usage", {
      userId,
      operation: "regenerateWorkoutPlan",
      tokenUsage: tokenUsage || { estimated: estimatedTokens },
      actualTokensUsed,
    });

    // Increment usage after successful regeneration with real token count
    // Only increment for TRIAL users (UNLIMITED users don't need tracking)
    if (accessLevel === AccessLevel.TRIAL) {
      await subscriptionService.incrementTrialUsage(
        userId,
        "regeneration",
        actualTokensUsed,
        "weekly"
      );
    }

    return {
      success: true,
      workout,
    };
  }

  /**
   * Regenerate workout plan asynchronously (returns job ID immediately)
   * @param userId User ID
   * @param requestBody Regeneration data
   */
  @Post("/{userId}/regenerate-async")
  @Response<{ success: boolean; jobId: number; message: string }>(
    400,
    "Bad Request"
  )
  @SuccessResponse(202, "Job queued successfully")
  public async regenerateWorkoutPlanAsync(
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
  ): Promise<{ success: boolean; jobId: number; message: string }> {
    logger.info("Async workout regeneration requested", {
      userId,
      operation: "regenerateWorkoutPlanAsync",
      metadata: {
        hasCustomFeedback: !!requestBody?.customFeedback,
        hasProfileData: !!requestBody?.profileData,
      },
    });

    try {
      // Create job record in database
      const job = await jobsService.createJob(
        userId,
        JobType.WORKOUT_REGENERATION,
        requestBody || {}
      );

      // Queue the job for processing
      const jobData: WorkoutRegenerationJobData & {
        userId: number;
        jobId: number;
      } = {
        userId,
        jobId: job.id,
        customFeedback: requestBody?.customFeedback,
        profileData: requestBody?.profileData,
      };

      await workoutGenerationQueue.add("regenerate-workout", jobData, {
        jobId: job.id.toString(),
        delay: 1000, // Small delay to ensure database transaction is committed
      });

      logger.info("Workout regeneration job queued successfully", {
        userId,
        jobId: job.id,
        operation: "regenerateWorkoutPlanAsync",
      });

      return {
        success: true,
        jobId: job.id,
        message:
          "Workout regeneration started. You will receive a notification when complete.",
      };
    } catch (error) {
      logger.error("Failed to queue workout regeneration job", error as Error, {
        userId,
        operation: "regenerateWorkoutPlanAsync",
      });
      throw error;
    }
  }

  /**
   * Fetch active workout
   * @param userId User ID
   */
  @Get("/{userId}/active-workout")
  @SuccessResponse(200, "Success")
  @Response(404, "No active workout found")
  public async fetchActiveWorkout(
    @Path() userId: number
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.fetchActiveWorkout(userId);
    if (!workout) {
      throw new Error("No active workout found");
    }
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
      threadId?: string;
    },
    @Request() request?: any
  ): Promise<PlanDayResponse> {
    const startTime = Date.now();

    logger.info("Daily workout regeneration request received", {
      userId,
      planDayId,
      operation: "regenerateDailyWorkout",
      metadata: {
        reason: requestBody.reason,
        stylesCount: requestBody.styles?.length || 0,
        limitationsCount: requestBody.limitations?.length || 0,
        requestTime: new Date().toISOString(),
      },
    });

    try {
      // Re-check limits in transaction (race condition protection)
      const accessLevel =
        await subscriptionService.getEffectiveAccessLevel(userId);
      const estimatedTokens = (request as any)?.estimatedTokens || 2000;

      // Block immediately if access is blocked
      if (accessLevel === AccessLevel.BLOCKED) {
        throw new Error("Subscription required for daily workout regeneration");
      }

      // Only check trial limits for TRIAL users
      if (accessLevel === AccessLevel.TRIAL) {
        const limitCheck = await subscriptionService.checkTrialLimits(
          userId,
          "regeneration",
          estimatedTokens,
          "daily"
        );
        if (!limitCheck.allowed) {
          throw new Error(limitCheck.reason || "Trial limit exceeded");
        }
      }

      // Clear any previous token usage before regeneration
      clearLastTokenUsage(userId);

      const planDay = await workoutService.regenerateDailyWorkout(
        userId,
        planDayId,
        requestBody.reason,
        requestBody.styles,
        requestBody.threadId
      );

      // Get real token usage from regeneration (or fallback to estimate)
      const tokenUsage = getLastTokenUsage(userId);
      const actualTokensUsed = tokenUsage?.totalTokens || estimatedTokens;

      // Increment usage after successful regeneration with real token count
      // Increment usage after successful regeneration with real token count
      // Only increment for TRIAL users (UNLIMITED users don't need tracking)
      if (accessLevel === AccessLevel.TRIAL) {
        await subscriptionService.incrementTrialUsage(
          userId,
          "regeneration",
          actualTokensUsed,
          "daily"
        );
      }

      const duration = Date.now() - startTime;
      logger.info("Daily workout regeneration completed successfully", {
        userId,
        planDayId,
        operation: "regenerateDailyWorkout",
        tokenUsage: tokenUsage || { estimated: estimatedTokens },
        actualTokensUsed,
        metadata: {
          duration: `${duration}ms`,
          completedAt: new Date().toISOString(),
        },
      });

      return {
        success: true,
        planDay,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Daily workout regeneration failed", error as Error, {
        userId,
        planDayId,
        operation: "regenerateDailyWorkout",
        metadata: {
          duration: `${duration}ms`,
          reason: requestBody.reason,
          errorTime: new Date().toISOString(),
        },
      });
      throw error;
    }
  }

  /**
   * Regenerate a single day's workout asynchronously
   * @param userId User ID
   * @param planDayId Plan day ID
   * @param requestBody Regeneration reason and optional styles
   */
  @Post("/{userId}/days/{planDayId}/regenerate-async")
  @Response<{ success: boolean; jobId: number; message: string }>(
    400,
    "Bad Request"
  )
  @SuccessResponse(202, "Job queued successfully")
  public async regenerateDailyWorkoutAsync(
    @Path() userId: number,
    @Path() planDayId: number,
    @Body()
    requestBody: {
      reason: string;
      styles?: string[];
      limitations?: string[];
      threadId?: string;
    }
  ): Promise<{ success: boolean; jobId: number; message: string }> {
    logger.info("Async daily workout regeneration requested", {
      userId,
      planDayId,
      operation: "regenerateDailyWorkoutAsync",
      metadata: {
        reason: requestBody.reason,
        stylesCount: requestBody.styles?.length || 0,
        limitationsCount: requestBody.limitations?.length || 0,
      },
    });

    try {
      // Create job record in database
      const job = await jobsService.createJob(
        userId,
        JobType.DAILY_REGENERATION,
        {
          planDayId,
          regenerationReason: requestBody.reason,
          regenerationStyles: requestBody.styles,
          threadId: requestBody.threadId,
        }
      );

      // Queue the job for processing
      const jobData: DailyRegenerationJobData & {
        userId: number;
        jobId: number;
      } = {
        userId,
        jobId: job.id,
        planDayId,
        regenerationReason: requestBody.reason,
        regenerationStyles: requestBody.styles,
        threadId: requestBody.threadId,
      };

      await workoutGenerationQueue.add("regenerate-daily-workout", jobData, {
        jobId: job.id.toString(),
        delay: 500, // Smaller delay for daily regeneration (faster operation)
      });

      logger.info("Daily workout regeneration job queued successfully", {
        userId,
        planDayId,
        jobId: job.id,
        operation: "regenerateDailyWorkoutAsync",
      });

      return {
        success: true,
        jobId: job.id,
        message:
          "Daily workout regeneration started. You will receive a notification when complete.",
      };
    } catch (error) {
      logger.error(
        "Failed to queue daily workout regeneration job",
        error as Error,
        {
          userId,
          planDayId,
          operation: "regenerateDailyWorkoutAsync",
        }
      );
      throw error;
    }
  }

  /**
   * Get workout history for a user
   * @param userId User ID
   */
  @Get("/{userId}/history")
  @Response<WorkoutsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWorkoutHistory(
    @Path() userId: number
  ): Promise<WorkoutsResponse> {
    const workouts = await workoutService.getWorkoutHistory(userId);
    return {
      success: true,
      workouts,
    };
  }

  /**
   * Get list of previous workouts with flexible time filtering
   * @param userId User ID
   */
  @Get("/{userId}/previous-workouts")
  @Response<{ success: boolean; workouts: any[] }>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getPreviousWorkouts(
    @Path() userId: number
  ): Promise<{ success: boolean; workouts: any[] }> {
    // For now, let's try 'all' to see if there are any workouts at all
    const workouts = await workoutService.getPreviousWorkouts(userId, "all");
    return {
      success: true,
      workouts,
    };
  }

  /**
   * Repeat a previous week's workout with a new start date
   * @param userId User ID
   * @param originalWorkoutId Original workout ID to repeat
   * @param requestBody New start date and optional modifications
   */
  @Post("/{userId}/repeat-week/{originalWorkoutId}")
  @Response<WorkoutResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async repeatPreviousWeekWorkout(
    @Path() userId: number,
    @Path() originalWorkoutId: number,
    @Body() requestBody: { newStartDate: string }
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.repeatPreviousWeekWorkout(
      userId,
      originalWorkoutId,
      requestBody.newStartDate
    );
    return {
      success: true,
      workout,
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
      logger.error("Error getting active workouts", error as Error, {
        operation: "getActiveWorkouts",
        metadata: { userId },
      });
      throw new Error("Failed to fetch active workouts");
    }
  }

  /**
   * Generate workout plan asynchronously (returns job ID immediately)
   * @param userId User ID
   * @param requestBody Generation options including timezone and profile data
   */
  @Post("/{userId}/generate-async")
  @Response<{ success: boolean; jobId: number; message: string }>(
    400,
    "Bad Request"
  )
  @SuccessResponse(202, "Job queued successfully")
  public async generateWorkoutPlanAsync(
    @Path() userId: number,
    @Body()
    requestBody?: {
      customFeedback?: string;
      timezone?: string;
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
  ): Promise<{ success: boolean; jobId: number; message: string }> {
    logger.info("Async workout generation requested", {
      userId,
      operation: "generateWorkoutPlanAsync",
      metadata: {
        hasCustomFeedback: !!requestBody?.customFeedback,
        hasProfileData: !!requestBody?.profileData,
        timezone: requestBody?.timezone,
      },
    });

    try {
      // Create job record in database
      const job = await jobsService.createJob(
        userId,
        JobType.WORKOUT_GENERATION,
        requestBody || {}
      );

      // Queue the job for processing
      const jobData: WorkoutGenerationJobData & {
        userId: number;
        jobId: number;
      } = {
        userId,
        jobId: job.id,
        customFeedback: requestBody?.customFeedback,
        timezone: requestBody?.timezone,
        profileData: requestBody?.profileData,
      };

      await workoutGenerationQueue.add("generate-workout", jobData, {
        jobId: job.id.toString(),
        delay: 1000, // Small delay to ensure database transaction is committed
      });

      logger.info("Workout generation job queued successfully", {
        userId,
        jobId: job.id,
        operation: "generateWorkoutPlanAsync",
      });

      return {
        success: true,
        jobId: job.id,
        message:
          "Workout generation started. You will receive a notification when complete.",
      };
    } catch (error) {
      logger.error("Failed to queue workout generation job", error as Error, {
        userId,
        operation: "generateWorkoutPlanAsync",
      });
      throw error;
    }
  }

  /**
   * Get job status by job ID
   * @param jobId Job ID
   */
  @Get("/jobs/{jobId}/status")
  @Response<{ success: boolean; error: string }>(404, "Job not found")
  @SuccessResponse(200, "Success")
  public async getJobStatus(@Path() jobId: number): Promise<{
    success: boolean;
    job: {
      id: number;
      status: string;
      progress: number;
      error?: string;
      workoutId?: number;
      createdAt: string;
      completedAt?: string;
    };
  }> {
    const job = await jobsService.getJob(jobId);

    if (!job) {
      this.setStatus(404);
      throw new Error("Job not found");
    }

    // Disable caching for active jobs to ensure fresh status
    if (job.status === "pending" || job.status === "processing") {
      this.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      this.setHeader("Pragma", "no-cache");
      this.setHeader("Expires", "0");
    }

    return {
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress || 0,
        error: job.error || undefined,
        workoutId: job.workoutId || undefined,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString(),
      },
    };
  }

  /**
   * Get user's job history
   * @param userId User ID
   */
  @Get("/{userId}/jobs")
  @SuccessResponse(200, "Success")
  public async getUserJobs(@Path() userId: number): Promise<{
    success: boolean;
    jobs: Array<{
      id: number;
      status: string;
      progress: number;
      error?: string;
      workoutId?: number;
      createdAt: string;
      completedAt?: string;
    }>;
  }> {
    const jobs = await jobsService.getUserJobs(
      userId,
      "workout_generation",
      20
    );

    return {
      success: true,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        progress: job.progress || 0,
        error: job.error || undefined,
        workoutId: job.workoutId || undefined,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString(),
      })),
    };
  }

  /**
   * Generate a rest day workout
   * @param userId User ID
   * @param requestBody Rest day workout parameters
   */
  @Post("/{userId}/rest-day-workout")
  @Response<{ success: boolean; jobId: number; message: string }>(
    400,
    "Bad Request"
  )
  @SuccessResponse(202, "Job queued successfully")
  public async generateRestDayWorkoutAsync(
    @Path() userId: number,
    @Body()
    requestBody: {
      date: string;
      reason: string;
      styles?: string[];
      limitations?: string[];
      threadId?: string;
    }
  ): Promise<{ success: boolean; jobId: number; message: string }> {
    logger.info("Rest day workout generation requested", {
      userId,
      operation: "generateRestDayWorkoutAsync",
      metadata: {
        date: requestBody.date,
        hasReason: !!requestBody.reason,
      },
    });

    try {
      // Get active workout to check if date is available
      const activeWorkout = await workoutService.fetchActiveWorkout(userId);
      if (!activeWorkout) {
        this.setStatus(400);
        throw new Error("No active workout found");
      }

      // Check if this date already has a workout
      const existingPlanDay = activeWorkout.planDays?.find(
        (day) => day.date === requestBody.date
      );
      if (existingPlanDay) {
        this.setStatus(400);
        throw new Error("This date already has a workout scheduled");
      }

      // Create a new plan day for the rest day
      const newPlanDay = await workoutService.createPlanDayForRestDay(
        activeWorkout.id,
        requestBody.date
      );

      // Create job record in database
      const job = await jobsService.createJob(
        userId,
        JobType.DAILY_REGENERATION,
        {
          planDayId: newPlanDay.id,
          regenerationReason: requestBody.reason,
          regenerationStyles: requestBody.styles,
          threadId: requestBody.threadId,
          isRestDayGeneration: true,
        }
      );

      // Queue the job for processing
      const jobData: DailyRegenerationJobData & {
        userId: number;
        jobId: number;
      } = {
        userId,
        jobId: job.id,
        planDayId: newPlanDay.id,
        regenerationReason: requestBody.reason,
        regenerationStyles: requestBody.styles,
        threadId: requestBody.threadId,
      };

      await workoutGenerationQueue.add("regenerate-daily-workout", jobData, {
        jobId: job.id.toString(),
        delay: 500,
      });

      logger.info("Rest day workout generation job queued successfully", {
        userId,
        planDayId: newPlanDay.id,
        jobId: job.id,
        operation: "generateRestDayWorkoutAsync",
      });

      return {
        success: true,
        jobId: job.id,
        message:
          "Rest day workout generation started. You will receive a notification when complete.",
      };
    } catch (error) {
      logger.error(
        "Failed to queue rest day workout generation job",
        error as Error,
        {
          userId,
          operation: "generateRestDayWorkoutAsync",
        }
      );
      throw error;
    }
  }

  /**
   * Register push notification token for user
   * @param userId User ID
   * @param requestBody Push token data
   */
  @Post("/{userId}/register-push-token")
  @Response<{ success: boolean; error: string }>(400, "Bad Request")
  @SuccessResponse(200, "Token registered successfully")
  public async registerPushToken(
    @Path() userId: number,
    @Body() requestBody: { pushToken: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      const success = await notificationService.registerPushToken(
        userId,
        requestBody.pushToken
      );

      if (!success) {
        this.setStatus(400);
        throw new Error("Invalid push token format");
      }

      return {
        success: true,
        message: "Push notification token registered successfully",
      };
    } catch (error) {
      logger.error("Failed to register push token", error as Error, {
        userId,
        operation: "registerPushToken",
      });
      throw error;
    }
  }
}

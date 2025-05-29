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
  WorkoutWithDetails,
  PlanDayWithExercises,
  PlanDayWithExercise,
  PlanDayResponse,
  PlanDayExerciseResponse,
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
  @Example<WorkoutsResponse>({
    success: true,
    workouts: [
      {
        id: 1,
        userId: 1,
        name: "Full Body Workout",
        description: "A complete full body workout",
        startDate: new Date(),
        endDate: new Date(),
        promptId: 1,
        isActive: true,
        completed: false,
        created_at: new Date(),
        updated_at: new Date(),
        planDays: [
          {
            id: 1,
            workoutId: 1,
            date: new Date(),
            name: "Day 1",
            description: "Upper body focus",
            dayNumber: 1,
            created_at: new Date(),
            updated_at: new Date(),
            exercises: [
              {
                id: 1,
                planDayId: 1,
                exerciseId: 1,
                sets: 3,
                reps: 12,
                weight: 50,
                restTime: 60,
                completed: false,
                notes: "Keep proper form",
                created_at: new Date(),
                updated_at: new Date(),
                exercise: {
                  id: 1,
                  name: "Push-up",
                  description: "A classic bodyweight exercise",
                  category: "strength",
                  difficulty: "beginner",
                  equipment: "none",
                  muscles_targeted: ["chest", "shoulders", "triceps"],
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              },
            ],
          },
        ],
      },
    ],
  })
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
  @Example<WorkoutsResponse>({
    success: true,
    workouts: [
      {
        id: 1,
        userId: 1,
        name: "Full Body Workout",
        description: "A complete full body workout",
        startDate: new Date(),
        endDate: new Date(),
        promptId: 1,
        isActive: true,
        completed: false,
        created_at: new Date(),
        updated_at: new Date(),
        planDays: [],
      },
    ],
  })
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
  @Example<WorkoutResponse>({
    success: true,
    workout: {
      id: 1,
      userId: 1,
      name: "Full Body Workout",
      description: "A complete full body workout",
      startDate: new Date(),
      endDate: new Date(),
      promptId: 1,
      isActive: true,
      completed: false,
      created_at: new Date(),
      updated_at: new Date(),
      planDays: [],
    },
  })
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
      workout,
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
  @Example<WorkoutResponse>({
    success: true,
    workout: {
      id: 1,
      userId: 1,
      name: "Full Body Workout",
      description: "A complete full body workout",
      startDate: new Date(),
      endDate: new Date(),
      promptId: 1,
      isActive: true,
      completed: false,
      created_at: new Date(),
      updated_at: new Date(),
      planDays: [],
    },
  })
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
  @Example<PlanDayResponse>({
    success: true,
    planDay: {
      id: 1,
      workoutId: 1,
      date: new Date(),
      name: "Day 1",
      description: "Upper body focus",
      dayNumber: 1,
      created_at: new Date(),
      updated_at: new Date(),
      exercises: [],
    },
  })
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
   * Create new plan day exercise
   * @param planDayId Plan day ID
   * @param requestBody Plan day exercise data
   */
  @Post("/days/{planDayId}/exercises")
  @Response<PlanDayExerciseResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  @Example<PlanDayExerciseResponse>({
    success: true,
    planDayExercise: {
      id: 1,
      planDayId: 1,
      exerciseId: 1,
      sets: 3,
      reps: 12,
      weight: 50,
      restTime: 60,
      completed: false,
      notes: "Keep proper form",
      created_at: new Date(),
      updated_at: new Date(),
      exercise: {
        id: 1,
        name: "Push-up",
        description: "A classic bodyweight exercise",
        category: "strength",
        difficulty: "beginner",
        equipment: "none",
        muscles_targeted: ["chest", "shoulders", "triceps"],
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
  })
  public async createPlanDayExercise(
    @Path() planDayId: number,
    @Body() requestBody: CreatePlanDayExerciseRequest
  ): Promise<PlanDayExerciseResponse> {
    const planDayExercise = await workoutService.createPlanDayExercise({
      ...requestBody,
      planDayId,
      completed: false,
    });
    return {
      success: true,
      planDayExercise,
    };
  }

  /**
   * Update plan day exercise
   * @param id Plan day exercise ID
   * @param requestBody Updated plan day exercise data
   */
  @Put("/exercises/{id}")
  @Response<PlanDayExerciseResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<PlanDayExerciseResponse>({
    success: true,
    planDayExercise: {
      id: 1,
      planDayId: 1,
      exerciseId: 1,
      sets: 3,
      reps: 12,
      weight: 50,
      restTime: 60,
      completed: false,
      notes: "Keep proper form",
      created_at: new Date(),
      updated_at: new Date(),
      exercise: {
        id: 1,
        name: "Push-up",
        description: "A classic bodyweight exercise",
        category: "strength",
        difficulty: "beginner",
        equipment: "none",
        muscles_targeted: ["chest", "shoulders", "triceps"],
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
  })
  public async updatePlanDayExercise(
    @Path() id: number,
    @Body() requestBody: Partial<InsertPlanDayExercise>
  ): Promise<PlanDayExerciseResponse> {
    const planDayExercise = await workoutService.updatePlanDayExercise(
      id,
      requestBody
    );
    return {
      success: true,
      planDayExercise,
    };
  }

  /**
   * Generate workout plan
   * @param userId User ID
   */
  @Post("/{userId}/generate")
  @Response<WorkoutResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async generateWorkoutPlan(
    @Path() userId: number
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.generateWorkoutPlan(userId);
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
    @Body() requestBody: { customFeedback?: string }
  ): Promise<WorkoutResponse> {
    const workout = await workoutService.regenerateWorkoutPlan(
      userId,
      requestBody.customFeedback
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
  @Get("/{userId}/active")
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
}

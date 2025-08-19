import { and, asc, desc, eq, gte, sql, not, or } from "drizzle-orm";
import {
  workouts,
  planDays,
  workoutBlocks,
  planDayExercises,
  exercises,
  exerciseLogs,
  type PlanDay,
  type WorkoutBlock,
  type PlanDayExercise,
  type Exercise,
  type Workout,
  InsertWorkout,
  InsertPlanDay,
  InsertWorkoutBlock,
  InsertPlanDayExercise,
} from "@/models";
import type {
  WorkoutWithDetails,
  PlanDayWithExercises,
  WorkoutBlockWithExercise,
  PlanDayWithExercise,
} from "@/types/workout/responses";
import { BaseService } from "@/services/base.service";
import { promptsService } from "./prompts.service";
import { exerciseService } from "./exercise.service";
import { AvailableEquipment, IntensityLevel } from "@/types/profile/types";
import { profileService } from "./profile.service";
import { PreferredDays } from "@/constants";
import { PreferredDay } from "@/types/profile/types";
import {
  getTodayString,
  createTimestamp,
  toUTCDate,
  formatTimestampForAPI,
  getCurrentDateString,
  getCurrentDateStringInTimezone,
  getDateForWeekday,
  getDateForWeekdayInTimezone,
  addDays,
  formatDateAsString,
} from "@/utils/date.utils";
import { workoutLogs } from "../models/logs.schema";
import { logger } from "@/utils/logger";
import {
  determineBlockType,
  generateBlockName,
  determineTimeCap,
  determineRounds,
} from "@/utils/workout-block-configuration.utils";
import { emitProgress } from "@/utils/websocket-progress.utils";

type DBWorkoutResult = {
  id: number;
  name: string;
  description: string | null;
  userId: number;
  startDate: string;
  endDate: string;
  promptId: number;
  isActive: boolean | null;
  completed: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  planDays: Array<{
    id: number;
    workoutId: number;
    date: string;
    instructions: string | null;
    name: string | null;
    description: string | null;
    dayNumber: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    isComplete: boolean | null;
    blocks: Array<{
      id: number;
      planDayId: number;
      blockType: string | null;
      blockName: string | null;
      blockDurationMinutes: number | null;
      timeCapMinutes: number | null;
      rounds: number | null;
      instructions: string | null;
      order: number | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      exercises: Array<{
        id: number;
        workoutBlockId: number;
        exerciseId: number;
        sets: number | null;
        reps: number | null;
        weight: number | null;
        duration: number | null;
        restTime: number | null;
        completed: boolean | null;
        notes: string | null;
        order: number | null;
        createdAt: Date | null;
        updatedAt: Date | null;
        exercise: {
          id: number;
          name: string;
          description: string | null;
          muscleGroups: string[];
          difficulty: string | null;
          equipment: string[] | null;
          link: string | null;
          createdAt: Date | null;
          updatedAt: Date | null;
        };
      }>;
    }>;
  }>;
};

type DBWorkoutQueryResult = {
  id: number;
  name: string;
  description: string | null;
  userId: number;
  startDate: string;
  endDate: string;
  promptId: number;
  isActive: boolean | null;
  completed: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  planDays: Array<{
    id: number;
    workoutId: number;
    date: string;
    instructions: string | null;
    name: string | null;
    description: string | null;
    dayNumber: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    isComplete: boolean | null;
    blocks: Array<{
      id: number;
      planDayId: number;
      blockType: string | null;
      blockName: string | null;
      blockDurationMinutes: number | null;
      timeCapMinutes: number | null;
      rounds: number | null;
      instructions: string | null;
      order: number | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      exercises: Array<{
        id: number;
        workoutBlockId: number;
        exerciseId: number;
        sets: number | null;
        reps: number | null;
        weight: number | null;
        duration: number | null;
        restTime: number | null;
        completed: boolean | null;
        notes: string | null;
        order: number | null;
        createdAt: Date | null;
        updatedAt: Date | null;
        exercise: {
          id: number;
          name: string;
          description: string | null;
          muscleGroups: string[];
          difficulty: string | null;
          equipment: string[] | null;
          link: string | null;
          createdAt: Date | null;
          updatedAt: Date | null;
        };
      }>;
    }>;
  }>;
};

export class WorkoutService extends BaseService {
  // Helper function to determine block type based on preferred styles
  private determineBlockType(
    preferredStyles: string[] | null | undefined
  ): string {
    return determineBlockType(preferredStyles);
  }

  // Helper function to generate appropriate block name based on type and styles
  private generateBlockName(
    blockType: string,
    preferredStyles: string[] | null | undefined
  ): string {
    return generateBlockName(blockType, preferredStyles);
  }

  // Helper function to determine time cap based on block type and duration
  private determineTimeCap(
    blockType: string,
    workoutDuration: number
  ): number | null {
    return determineTimeCap(blockType, workoutDuration);
  }

  // Helper function to determine rounds based on block type and duration
  private determineRounds(blockType: string, workoutDuration: number): number {
    return determineRounds(blockType, workoutDuration);
  }

  private transformWorkout(workout: DBWorkoutResult): WorkoutWithDetails {
    const transformedWorkout: WorkoutWithDetails = {
      id: workout.id,
      userId: workout.userId,
      name: workout.name,
      description: workout.description ?? undefined,
      startDate: workout.startDate,
      endDate: workout.endDate,
      promptId: workout.promptId,
      isActive: workout.isActive ?? false,
      completed: workout.completed ?? false,
      created_at: new Date(workout.createdAt ?? Date.now()),
      updated_at: new Date(workout.updatedAt ?? Date.now()),
      planDays: workout.planDays.map((planDay, index) => ({
        id: planDay.id,
        workoutId: planDay.workoutId,
        date: planDay.date, // Keep as string to avoid timezone conversion
        instructions: planDay.instructions ?? undefined,
        name: planDay.name || `Day ${index + 1}`,
        description: planDay.description ?? undefined,
        dayNumber: planDay.dayNumber || index + 1,
        isComplete: planDay.isComplete ?? false,
        created_at: new Date(planDay.createdAt ?? Date.now()),
        updated_at: new Date(planDay.updatedAt ?? Date.now()),
        blocks: planDay.blocks.map((block, blockIndex) => ({
          id: block.id,
          blockType: block.blockType ?? undefined,
          blockName: block.blockName ?? undefined,
          blockDurationMinutes: block.blockDurationMinutes ?? undefined,
          timeCapMinutes: block.timeCapMinutes ?? undefined,
          rounds: block.rounds ?? undefined,
          instructions: block.instructions ?? undefined,
          order: block.order ?? undefined,
          created_at: new Date(block.createdAt ?? Date.now()),
          updated_at: new Date(block.updatedAt ?? Date.now()),
          exercises: block.exercises.map((exercise) => ({
            id: exercise.id,
            workoutBlockId: exercise.workoutBlockId,
            exerciseId: exercise.exerciseId,
            sets: exercise.sets ?? undefined,
            reps: exercise.reps ?? undefined,
            weight: exercise.weight ?? undefined,
            duration: exercise.duration ?? undefined,
            restTime: exercise.restTime ?? undefined,
            completed: exercise.completed ?? false,
            notes: exercise.notes ?? undefined,
            order: exercise.order ?? undefined,
            created_at: new Date(exercise.createdAt ?? Date.now()),
            updated_at: new Date(exercise.updatedAt ?? Date.now()),
            exercise: {
              id: exercise.exercise.id,
              name: exercise.exercise.name,
              description: exercise.exercise.description ?? undefined,
              category:
                exercise.exercise.muscleGroups &&
                exercise.exercise.muscleGroups.length > 0
                  ? exercise.exercise.muscleGroups[0]
                  : "general",
              difficulty: exercise.exercise.difficulty || "beginner",
              equipment: Array.isArray(exercise.exercise.equipment)
                ? exercise.exercise.equipment.join(", ")
                : (exercise.exercise.equipment ?? undefined),
              link: exercise.exercise.link ?? undefined,
              muscles_targeted: exercise.exercise.muscleGroups || [],
              created_at: new Date(exercise.exercise.createdAt ?? Date.now()),
              updated_at: new Date(exercise.exercise.updatedAt ?? Date.now()),
            },
          })),
        })),
      })),
    };
    return transformedWorkout;
  }

  async createWorkout(data: InsertWorkout): Promise<Workout> {
    const now = new Date();
    const [workout] = await this.db
      .insert(workouts)
      .values({
        ...data,
        startDate: sql`${data.startDate}::date`,
        endDate: sql`${data.endDate}::date`,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const completeWorkout = (await this.db.query.workouts.findFirst({
      where: eq(workouts.id, workout.id),
      with: {
        planDays: {
          with: {
            blocks: {
              with: {
                exercises: {
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    })) as unknown as DBWorkoutQueryResult;

    if (!completeWorkout) {
      throw new Error("Failed to create workout");
    }

    // Transform to match the expected return type
    return {
      ...completeWorkout,
      createdAt: completeWorkout.createdAt || now,
      updatedAt: completeWorkout.updatedAt || now,
    } as Workout;
  }

  async getUserWorkouts(userId: number): Promise<WorkoutWithDetails[]> {
    const userWorkouts = (await this.db.query.workouts.findMany({
      where: eq(workouts.userId, userId),
      with: {
        planDays: {
          with: {
            blocks: {
              with: {
                exercises: {
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    })) as unknown as DBWorkoutQueryResult[];

    return userWorkouts.map((workout) => {
      const transformedWorkout: DBWorkoutResult = {
        id: workout.id,
        name: workout.name,
        description: workout.description,
        userId: workout.userId,
        startDate: workout.startDate || getTodayString(),
        endDate: workout.endDate || getTodayString(),
        promptId: workout.promptId,
        isActive: workout.isActive,
        completed: workout.completed,
        createdAt: workout.createdAt,
        updatedAt: workout.updatedAt,
        planDays: workout.planDays.map((pd, index) => ({
          id: pd.id,
          workoutId: pd.workoutId,
          date: pd.date || getTodayString(),
          instructions: pd.instructions,
          name: pd.name,
          description: pd.description,
          dayNumber: pd.dayNumber,
          isComplete: pd.isComplete,
          createdAt: pd.createdAt,
          updatedAt: pd.updatedAt,
          blocks: pd.blocks.map((block, blockIndex) => ({
            id: block.id,
            planDayId: block.planDayId,
            blockType: block.blockType,
            blockName: block.blockName,
            blockDurationMinutes: block.blockDurationMinutes,
            timeCapMinutes: block.timeCapMinutes,
            rounds: block.rounds,
            instructions: block.instructions,
            order: block.order,
            createdAt: block.createdAt,
            updatedAt: block.updatedAt,
            exercises: block.exercises.map((ex) => ({
              id: ex.id,
              workoutBlockId: ex.workoutBlockId,
              exerciseId: ex.exerciseId,
              sets: ex.sets,
              reps: ex.reps,
              weight: ex.weight,
              duration: ex.duration,
              restTime: ex.restTime,
              completed: ex.completed,
              notes: ex.notes,
              order: ex.order,
              createdAt: ex.createdAt,
              updatedAt: ex.updatedAt,
              exercise: {
                id: ex.exercise.id,
                name: ex.exercise.name,
                description: ex.exercise.description,
                muscleGroups: ex.exercise.muscleGroups || [],
                difficulty: ex.exercise.difficulty,
                equipment: ex.exercise.equipment,
                link: ex.exercise.link,
                createdAt: ex.exercise.createdAt,
                updatedAt: ex.exercise.updatedAt,
              },
            })),
          })),
        })),
      };
      return this.transformWorkout(transformedWorkout);
    });
  }

  async getActiveWorkouts(userId: number): Promise<WorkoutWithDetails[]> {
    const activeWorkouts = (await this.db.query.workouts.findMany({
      where: and(
        eq(workouts.userId, userId),
        eq(workouts.completed, false),
        eq(workouts.isActive, true)
      ),
      with: {
        planDays: {
          with: {
            blocks: {
              with: {
                exercises: {
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    })) as unknown as DBWorkoutQueryResult[];

    return activeWorkouts.map((workout) => {
      const transformedWorkout: DBWorkoutResult = {
        id: workout.id,
        name: workout.name,
        description: workout.description,
        userId: workout.userId,
        startDate: workout.startDate || getTodayString(),
        endDate: workout.endDate || getTodayString(),
        promptId: workout.promptId,
        isActive: workout.isActive,
        completed: workout.completed,
        createdAt: workout.createdAt,
        updatedAt: workout.updatedAt,
        planDays: workout.planDays.map((pd) => ({
          id: pd.id,
          workoutId: pd.workoutId,
          date: pd.date || getTodayString(),
          instructions: pd.instructions,
          name: pd.name,
          description: pd.description,
          dayNumber: pd.dayNumber,
          isComplete: pd.isComplete,
          createdAt: pd.createdAt,
          updatedAt: pd.updatedAt,
          blocks: pd.blocks.map((block) => ({
            id: block.id,
            planDayId: block.planDayId,
            blockType: block.blockType,
            blockName: block.blockName,
            blockDurationMinutes: block.blockDurationMinutes,
            timeCapMinutes: block.timeCapMinutes,
            rounds: block.rounds,
            instructions: block.instructions,
            order: block.order,
            createdAt: block.createdAt,
            updatedAt: block.updatedAt,
            exercises: block.exercises.map((ex) => ({
              id: ex.id,
              workoutBlockId: ex.workoutBlockId,
              exerciseId: ex.exerciseId,
              sets: ex.sets,
              reps: ex.reps,
              weight: ex.weight,
              duration: ex.duration,
              restTime: ex.restTime,
              completed: ex.completed,
              notes: ex.notes,
              order: ex.order,
              createdAt: ex.createdAt,
              updatedAt: ex.updatedAt,
              exercise: {
                id: ex.exercise.id,
                name: ex.exercise.name,
                description: ex.exercise.description,
                muscleGroups: ex.exercise.muscleGroups || [],
                difficulty: ex.exercise.difficulty,
                equipment: ex.exercise.equipment,
                link: ex.exercise.link,
                createdAt: ex.exercise.createdAt,
                updatedAt: ex.exercise.updatedAt,
              },
            })),
          })),
        })),
      };
      return this.transformWorkout(transformedWorkout);
    });
  }

  async updateWorkout(
    id: number,
    data: Partial<InsertWorkout>
  ): Promise<WorkoutWithDetails> {
    const [workout] = await this.db
      .update(workouts)
      .set({
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description || null,
        }),
        ...(data.startDate && { startDate: sql`${data.startDate}::date` }),
        ...(data.endDate && { endDate: sql`${data.endDate}::date` }),
        ...(data.completed !== undefined && { completed: data.completed }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      })
      .where(eq(workouts.id, id))
      .returning();

    if (!workout) {
      throw new Error("Workout not found");
    }

    const updatedWorkout = await this.db.query.workouts.findFirst({
      where: eq(workouts.id, workout.id),
      with: {
        planDays: {
          with: {
            blocks: {
              with: {
                exercises: {
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!updatedWorkout) {
      throw new Error("Updated workout not found");
    }

    return this.transformWorkout(updatedWorkout as unknown as DBWorkoutResult);
  }

  async createPlanDay(data: InsertPlanDay): Promise<PlanDayWithExercises> {
    const [planDay] = await this.db.insert(planDays).values(data).returning();
    return {
      id: planDay.id,
      workoutId: planDay.workoutId,
      date: planDay.date, // Keep as string to avoid timezone conversion
      instructions: planDay.instructions ?? undefined,
      name: planDay.name || "",
      description: planDay.description ?? undefined,
      dayNumber: planDay.dayNumber || 1,
      created_at: new Date(planDay.createdAt ?? Date.now()),
      updated_at: new Date(planDay.updatedAt ?? Date.now()),
      blocks: [],
    };
  }

  async createWorkoutBlock(data: InsertWorkoutBlock): Promise<WorkoutBlock> {
    const [workoutBlock] = await this.db
      .insert(workoutBlocks)
      .values(data)
      .returning();
    return workoutBlock;
  }

  async createPlanDayExercise(
    data: InsertPlanDayExercise
  ): Promise<WorkoutBlockWithExercise> {
    const [planDayExercise] = await this.db
      .insert(planDayExercises)
      .values(data)
      .returning();

    const exercise = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, planDayExercise.exerciseId),
    });

    if (!exercise) {
      throw new Error("Exercise not found");
    }

    return {
      id: planDayExercise.id,
      workoutBlockId: planDayExercise.workoutBlockId,
      exerciseId: planDayExercise.exerciseId,
      sets: planDayExercise.sets ?? undefined,
      reps: planDayExercise.reps ?? undefined,
      weight: planDayExercise.weight ?? undefined,
      duration: planDayExercise.duration ?? undefined,
      restTime: planDayExercise.restTime ?? undefined,
      completed: planDayExercise.completed ?? false,
      notes: planDayExercise.notes ?? undefined,
      order: planDayExercise.order ?? undefined,
      created_at: new Date(planDayExercise.createdAt ?? Date.now()),
      updated_at: new Date(planDayExercise.updatedAt ?? Date.now()),
      exercise: {
        id: exercise.id,
        name: exercise.name,
        description: exercise.description ?? undefined,
        category:
          exercise.muscleGroups && exercise.muscleGroups.length > 0
            ? exercise.muscleGroups[0]
            : "general",
        difficulty: exercise.difficulty || "beginner",
        equipment: Array.isArray(exercise.equipment)
          ? exercise.equipment.join(", ")
          : (exercise.equipment ?? undefined),
        link: exercise.link ?? undefined,
        muscles_targeted: exercise.muscleGroups || [],
        created_at: new Date(exercise.createdAt ?? Date.now()),
        updated_at: new Date(exercise.updatedAt ?? Date.now()),
      },
    };
  }

  async updatePlanDayExercise(
    id: number,
    data: Partial<InsertPlanDayExercise>
  ): Promise<PlanDayWithExercise> {
    const [exercise] = await this.db
      .update(planDayExercises)
      .set({
        ...(data.sets !== undefined && { sets: data.sets ?? null }),
        ...(data.reps !== undefined && { reps: data.reps ?? null }),
        ...(data.weight !== undefined && { weight: data.weight ?? null }),
        ...(data.duration !== undefined && { duration: data.duration ?? null }),
        ...(data.restTime !== undefined && { restTime: data.restTime ?? null }),
      })
      .where(eq(planDayExercises.id, id))
      .returning();

    if (!exercise) {
      throw new Error("Exercise not found");
    }

    // Get the workout block to find the planDayId
    const workoutBlock = await this.db.query.workoutBlocks.findFirst({
      where: eq(workoutBlocks.id, exercise.workoutBlockId),
    });

    if (!workoutBlock) {
      throw new Error("Workout block not found");
    }

    const exerciseDetails = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, exercise.exerciseId),
    });

    if (!exerciseDetails) {
      throw new Error("Exercise not found");
    }

    return {
      id: exercise.id,
      workoutBlockId: exercise.workoutBlockId,
      planDayId: workoutBlock.planDayId, // Get planDayId from the workout block
      exerciseId: exercise.exerciseId,
      sets: exercise.sets ?? undefined,
      reps: exercise.reps ?? undefined,
      weight: exercise.weight ?? undefined,
      duration: exercise.duration ?? undefined,
      restTime: exercise.restTime ?? undefined,
      completed: exercise.completed ?? false,
      notes: exercise.notes ?? undefined,
      order: exercise.order ?? undefined,
      created_at: new Date(exercise.createdAt ?? Date.now()),
      updated_at: new Date(exercise.updatedAt ?? Date.now()),
      exercise: {
        id: exerciseDetails.id,
        name: exerciseDetails.name,
        description: exerciseDetails.description ?? undefined,
        category:
          exerciseDetails.muscleGroups &&
          exerciseDetails.muscleGroups.length > 0
            ? exerciseDetails.muscleGroups[0]
            : "general",
        difficulty: exerciseDetails.difficulty || "beginner",
        equipment: Array.isArray(exerciseDetails.equipment)
          ? exerciseDetails.equipment.join(", ")
          : (exerciseDetails.equipment ?? undefined),
        link: exerciseDetails.link ?? undefined,
        muscles_targeted: exerciseDetails.muscleGroups || [],
        created_at: new Date(exerciseDetails.createdAt ?? Date.now()),
        updated_at: new Date(exerciseDetails.updatedAt ?? Date.now()),
      },
    };
  }

  async getWorkoutById(id: number): Promise<DBWorkoutResult> {
    const workout = await this.db.query.workouts.findFirst({
      where: eq(workouts.id, id),
      with: {
        planDays: {
          with: {
            blocks: {
              with: {
                exercises: {
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    return workout as unknown as DBWorkoutResult;
  }

  async generateWorkoutPlan(
    userId: number,
    customFeedback?: string,
    timezone?: string
  ): Promise<WorkoutWithDetails> {
    // Emit 5% - Starting
    emitProgress(userId, 5);

    // First, find and deactivate the current active workout(s)
    const activeWorkouts = await this.db
      .select({ id: workouts.id, name: workouts.name })
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)));

    if (activeWorkouts.length > 0) {
      logger.info("Found active workouts, deactivating them", {
        operation: "generateWorkoutPlan",
        userId,
        metadata: {
          count: activeWorkouts.length,
          workouts: activeWorkouts.map((w) => `ID: ${w.id}, Name: ${w.name}`),
        },
      });

      // Deactivate all current active workouts
      await this.db
        .update(workouts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)));

      logger.info("Successfully deactivated active workouts", {
        operation: "generateWorkoutPlan",
        userId,
      });
    } else {
      logger.info("No active workouts found for user", {
        userId,
        operation: "generateWorkoutPlan",
      });
    }

    // Try chunked generation first, fallback to regular generation if it fails
    let response, promptId;
    try {
      const result = await promptsService.generateChunkedPrompt(
        userId,
        customFeedback
      );
      response = result.response;
      promptId = result.promptId;
    } catch (chunkedError: any) {
      logger.warn(
        "Chunked workout generation failed, falling back to regular generation",
        {
          userId,
          operation: "generateWorkoutPlan",
          error: (chunkedError as Error).message,
        }
      );
      try {
        const result = await promptsService.generatePrompt(
          userId,
          customFeedback
        );
        response = result.response;
        promptId = result.promptId;
        logger.info("Fallback workout generation successful", {
          userId,
          operation: "generateWorkoutPlan",
        });
      } catch (fallbackError: any) {
        logger.error(
          "Both chunked and fallback generation failed",
          fallbackError as Error,
          {
            userId,
            operation: "generateWorkoutPlan",
          }
        );
        throw new Error(
          `Workout generation failed: ${(fallbackError as Error).message}`
        );
      }
    }
    const profile = await profileService.getProfileByUserId(userId);
    // Calculate startDate and endDate as YYYY-MM-DD strings in user's timezone
    const startDate = timezone
      ? getCurrentDateStringInTimezone(timezone)
      : getCurrentDateString();
    const endDate = addDays(startDate, 6);

    // Emit 85% - Starting database creation
    emitProgress(userId, 85);

    const workout = await this.createWorkout({
      userId,
      promptId,
      startDate,
      endDate,
      name: response.name,
      description: response.description,
    });

    if (response.exercisesToAdd) {
      for (const exercise of response.exercisesToAdd) {
        await exerciseService.createExerciseIfNotExists({
          name: exercise.name,
          description: exercise.description,
          equipment: exercise.equipment as AvailableEquipment[],
          muscleGroups: exercise.muscleGroups,
          difficulty: exercise.difficulty as IntensityLevel,
          instructions: exercise.instructions,
          link: exercise.link,
        });
      }
    }

    const workoutPlan = response.workoutPlan;
    const availableDays = profile?.availableDays || []; // e.g. ["tuesday", "wednesday", "saturday"]
    const today = timezone
      ? getCurrentDateStringInTimezone(timezone)
      : getCurrentDateString();

    // Get today's weekday in the specified timezone
    const todayDay = timezone
      ? new Date()
          .toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: timezone,
          })
          .toLowerCase()
      : new Date()
          .toLocaleDateString("en-US", { weekday: "long" })
          .toLowerCase();

    // New logic for rotating available days
    const daysOfWeek = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const todayIndex = daysOfWeek.indexOf(todayDay);
    const sortedAvailable = availableDays
      .map((day) => ({ day, index: daysOfWeek.indexOf(day) }))
      .sort(
        (a, b) =>
          ((a.index - todayIndex + 7) % 7) - ((b.index - todayIndex + 7) % 7)
      )
      .map((obj) => obj.day);
    const rotatedDays = sortedAvailable;

    // Optimize database operations with bulk inserts and transactions
    await this.db.transaction(async (tx) => {
      let referenceDate = today;

      // Prepare bulk data for plan days
      const planDaysData: InsertPlanDay[] = [];
      const workoutBlocksData: InsertWorkoutBlock[] = [];
      const planDayExercisesData: InsertPlanDayExercise[] = [];
      const exerciseDetailsMap = new Map<string, any>();

      // First pass: collect all exercise names and fetch them
      const allExerciseNames = new Set<string>();
      for (const day of workoutPlan) {
        for (const block of day.blocks) {
          for (const exercise of block.exercises) {
            allExerciseNames.add(exercise.exerciseName);
          }
        }
      }

      // Fetch all exercises in parallel
      const exercisePromises = Array.from(allExerciseNames).map(
        async (name) => {
          const exercise = await exerciseService.getExerciseByName(name);
          if (exercise) {
            exerciseDetailsMap.set(name, exercise);
          }
        }
      );
      await Promise.all(exercisePromises);

      // Second pass: prepare all data structures
      for (let i = 0; i < workoutPlan.length; i++) {
        const availableDay = rotatedDays[i % rotatedDays.length];
        const scheduledDate = timezone
          ? getDateForWeekdayInTimezone(availableDay, referenceDate, timezone)
          : getDateForWeekday(availableDay, referenceDate);

        // Move reference date to the day after the scheduledDate to prevent same day reuse
        referenceDate = addDays(scheduledDate, 1);

        planDaysData.push({
          workoutId: workout.id,
          date: scheduledDate,
          instructions: workoutPlan[i].instructions,
          name: workoutPlan[i].name,
          description: workoutPlan[i].description,
          dayNumber: i,
        });
      }

      // Bulk insert plan days
      const createdPlanDays = await tx
        .insert(planDays)
        .values(planDaysData)
        .returning();

      // Prepare blocks data with plan day IDs
      for (let i = 0; i < workoutPlan.length; i++) {
        const planDay = createdPlanDays[i];
        for (
          let blockIndex = 0;
          blockIndex < workoutPlan[i].blocks.length;
          blockIndex++
        ) {
          const block = workoutPlan[i].blocks[blockIndex];
          workoutBlocksData.push({
            planDayId: planDay.id,
            blockType: block.blockType,
            blockName: block.blockName,
            blockDurationMinutes: block.blockDurationMinutes,
            timeCapMinutes: block.timeCapMinutes,
            rounds: block.rounds,
            instructions: block.instructions,
            order: block.order,
          });
        }
      }

      // Bulk insert workout blocks
      const createdWorkoutBlocks = await tx
        .insert(workoutBlocks)
        .values(workoutBlocksData)
        .returning();

      // Prepare exercise data with workout block IDs
      let blockIndex = 0;
      for (let i = 0; i < workoutPlan.length; i++) {
        for (let j = 0; j < workoutPlan[i].blocks.length; j++) {
          const block = workoutPlan[i].blocks[j];
          const workoutBlock = createdWorkoutBlocks[blockIndex];

          for (
            let exerciseIndex = 0;
            exerciseIndex < block.exercises.length;
            exerciseIndex++
          ) {
            const exercise = block.exercises[exerciseIndex];
            const exerciseDetails = exerciseDetailsMap.get(
              exercise.exerciseName
            );

            if (exerciseDetails) {
              planDayExercisesData.push({
                workoutBlockId: workoutBlock.id,
                exerciseId: exerciseDetails.id,
                sets: exercise.sets,
                reps: exercise.reps,
                weight: exercise.weight,
                duration: exercise.duration,
                restTime: exercise.restTime,
                notes: exercise.notes,
                order: exercise.order,
              });
            }
          }
          blockIndex++;
        }
      }

      // Bulk insert plan day exercises
      if (planDayExercisesData.length > 0) {
        await tx
          .insert(planDayExercises)
          .values(planDayExercisesData)
          .returning();
      }
    });

    // Option 1: fetch full workout with planDays and exercises, then transform and return
    const generatedWorkout = await this.getWorkoutById(workout.id);
    if (!generatedWorkout) throw new Error("Workout not found");

    // Emit 100% - Complete
    emitProgress(userId, 100, true);

    return this.transformWorkout(
      generatedWorkout as unknown as DBWorkoutResult
    );
  }

  async fetchActiveWorkout(userId: number): Promise<WorkoutWithDetails | null> {
    try {
      const today = new Date();
      logger.info("Fetching active workout", {
        operation: "fetchActiveWorkout",
        metadata: { userId, today: today.toISOString() },
      });

      const workout = await this.db.query.workouts.findFirst({
        where: and(
          eq(workouts.userId, userId),
          eq(workouts.isActive, true),
          eq(workouts.completed, false),
          sql`${workouts.startDate}::date <= ${today}::date AND ${workouts.endDate}::date >= ${today}::date`
        ),
        with: {
          planDays: {
            with: {
              blocks: {
                with: {
                  exercises: {
                    with: {
                      exercise: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!workout) {
        logger.info("No active workout found", {
          operation: "fetchActiveWorkout",
          metadata: { userId },
        });
        return null;
      }

      logger.info("Active workout found", {
        operation: "fetchActiveWorkout",
        metadata: {
          userId,
          workoutId: workout.id,
          isActive: workout.isActive,
          completed: workout.completed,
          startDate: workout.startDate,
          endDate: workout.endDate,
        },
      });

      return this.transformWorkout(workout as unknown as DBWorkoutResult);
    } catch (error) {
      logger.error("Error fetching active workout", error as Error, {
        operation: "fetchActiveWorkout",
        metadata: { userId },
      });
      // Return null instead of throwing - no active workout is a valid state
      return null;
    }
  }

  async regenerateWorkoutPlan(
    userId: number,
    customFeedback?: string,
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
    }
  ): Promise<WorkoutWithDetails> {
    if (profileData) {
      await profileService.createOrUpdateProfile({
        userId,
        age: profileData.age ?? null,
        height: profileData.height ?? null,
        weight: profileData.weight ?? null,
        gender: profileData.gender ?? null,
        goals: profileData.goals ?? null,
        limitations: profileData.limitations ?? null,
        fitnessLevel: profileData.fitnessLevel ?? null,
        environment: profileData.environment?.[0] ?? null,
        equipment: profileData.equipment ?? null,
        otherEquipment: (profileData as any).otherEquipment ?? null,
        preferredStyles: profileData.workoutStyles ?? null,
        availableDays: profileData.availableDays ?? null,
        workoutDuration: profileData.workoutDuration ?? null,
        intensityLevel: profileData.intensityLevel?.toString() ?? null,
        medicalNotes: profileData.medicalNotes ?? null,
      } as any);
    }

    // First, find and deactivate the current active workout(s)
    const activeWorkouts = await this.db
      .select({ id: workouts.id, name: workouts.name })
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)));

    if (activeWorkouts.length > 0) {
      logger.info(
        "Found active workouts, deactivating them before regeneration",
        {
          userId,
          operation: "regenerateWorkoutPlan",
          metadata: {
            count: activeWorkouts.length,
            workouts: activeWorkouts.map((w) => `ID: ${w.id}, Name: ${w.name}`),
          },
        }
      );

      // Deactivate all current active workouts
      await this.db
        .update(workouts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)));

      logger.info(
        "Successfully deactivated active workouts before regeneration",
        {
          userId,
          operation: "regenerateWorkoutPlan",
        }
      );
    }

    const workout = await this.generateWorkoutPlan(userId, customFeedback);
    return workout;
  }

  async regenerateDailyWorkout(
    userId: number,
    planDayId: number,
    regenerationReason: string,
    regenerationStyles?: string[]
  ): Promise<PlanDayWithExercises> {
    try {
      // Emit 5% - Starting
      emitProgress(userId, 5);

      // Get the existing plan day with its exercises
      const existingPlanDay = await this.db.query.planDays.findFirst({
        where: eq(planDays.id, planDayId),
        with: {
          blocks: {
            with: {
              exercises: {
                with: {
                  exercise: true,
                },
              },
            },
          },
        },
      });

      if (!existingPlanDay) {
        throw new Error("Plan day not found");
      }

      // Get user profile for style determination
      const profile = await profileService.getProfileByUserId(userId);

      // Use regeneration styles if provided, otherwise fall back to user's preferred styles
      const stylesToUse = regenerationStyles || profile?.preferredStyles;

      // Programmatically determine block characteristics based on styles
      const determinedBlockType = this.determineBlockType(stylesToUse);
      const determinedBlockName = this.generateBlockName(
        determinedBlockType,
        stylesToUse
      );
      const determinedTimeCap = this.determineTimeCap(
        determinedBlockType,
        profile?.workoutDuration || 30
      );
      const determinedRounds = this.determineRounds(
        determinedBlockType,
        profile?.workoutDuration || 30
      );

      // Format the previous workout for the AI prompt
      const previousWorkout = {
        day: (existingPlanDay as any).dayNumber || 1,
        exercises: existingPlanDay.blocks[0].exercises.map((ex) => ({
          exerciseName: ex.exercise.name,
          sets: ex.sets || 0,
          reps: ex.reps || 0,
          weight: ex.weight || 0,
          duration: ex.duration || 0,
          restTime: ex.restTime || 0,
          notes: ex.notes || "",
        })),
      };

      // Emit 15% - Calling AI
      emitProgress(userId, 15);

      const result = await promptsService.generateDailyRegenerationPrompt(
        userId,
        (existingPlanDay as any).dayNumber || 1,
        previousWorkout,
        regenerationReason
      );
      const { response } = result;

      // Emit 75% - AI complete, saving to database
      emitProgress(userId, 75);

      // Add any new exercises to the database (with duplicate checking)
      if (response.exercisesToAdd) {
        for (const exercise of response.exercisesToAdd) {
          await exerciseService.createExerciseIfNotExists({
            name: exercise.name,
            description: exercise.description,
            equipment: exercise.equipment as AvailableEquipment[],
            muscleGroups: exercise.muscleGroups,
            difficulty: exercise.difficulty as IntensityLevel,
            instructions: exercise.instructions,
            link: exercise.link,
          });
        }
      }

      // First, delete all exercise logs that reference these plan day exercises
      const planDayExerciseIds = existingPlanDay.blocks[0].exercises.map(
        (ex) => ex.id
      );
      if (planDayExerciseIds.length > 0) {
        await this.db
          .delete(exerciseLogs)
          .where(
            sql`plan_day_exercise_id IN (${sql.join(
              planDayExerciseIds,
              sql`, `
            )})`
          );
      }

      // Then delete all existing exercises for this plan day
      await this.db
        .delete(planDayExercises)
        .where(
          eq(planDayExercises.workoutBlockId, existingPlanDay.blocks[0].id)
        );

      // Create new exercises for this plan day
      const newExercises: any[] = [];
      // The response structure has exercises nested inside blocks
      if (response.blocks && response.blocks.length > 0) {
        for (const block of response.blocks) {
          if (block.exercises) {
            for (const exercise of block.exercises) {
              const exerciseDetails = await exerciseService.getExerciseByName(
                exercise.exerciseName
              );
              if (exerciseDetails) {
                const newExercise = await this.createPlanDayExercise({
                  workoutBlockId: existingPlanDay.blocks[0].id,
                  exerciseId: exerciseDetails.id,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  weight: exercise.weight,
                  duration: exercise.duration,
                  restTime: exercise.restTime,
                  notes: exercise.notes,
                  order: exercise.order,
                });
                newExercises.push(newExercise);
              }
            }
          }
        }
      }

      // Update the plan day with new instructions, name, and description from response
      // Reset isComplete to false since this is a new regenerated workout
      await this.db
        .update(planDays)
        .set({
          name: response.name || existingPlanDay.name,
          description: response.description || existingPlanDay.description,
          instructions: response.instructions,
          isComplete: false,
          updatedAt: new Date(),
        })
        .where(eq(planDays.id, planDayId));

      // Update the workout block with programmatically determined block info
      // Get block info from the response if available
      const responseBlock =
        response.blocks && response.blocks.length > 0
          ? response.blocks[0]
          : null;
      await this.db
        .update(workoutBlocks)
        .set({
          blockType: responseBlock?.blockType || determinedBlockType,
          blockName: responseBlock?.blockName || determinedBlockName,
          blockDurationMinutes: responseBlock?.blockDurationMinutes || null,
          timeCapMinutes: responseBlock?.timeCapMinutes || determinedTimeCap,
          rounds: responseBlock?.rounds || determinedRounds,
          instructions: responseBlock?.instructions || null,
          updatedAt: new Date(),
        })
        .where(eq(workoutBlocks.id, existingPlanDay.blocks[0].id));

      // Emit 100% - Complete
      emitProgress(userId, 100, true);

      // Return the updated plan day with new exercises
      return {
        id: existingPlanDay.id,
        workoutId: existingPlanDay.workoutId,
        date: existingPlanDay.date, // Keep as string to avoid timezone conversion
        instructions: response.instructions ?? undefined,
        name: response.name || existingPlanDay.name || "",
        description:
          response.description || (existingPlanDay.description ?? undefined),
        dayNumber: existingPlanDay.dayNumber || 1,
        created_at: new Date(existingPlanDay.createdAt ?? Date.now()),
        updated_at: new Date(),
        blocks: existingPlanDay.blocks.map((block, index) => ({
          id: block.id,
          blockType: responseBlock?.blockType || (block.blockType ?? undefined),
          blockName: responseBlock?.blockName || (block.blockName ?? undefined),
          blockDurationMinutes:
            responseBlock?.blockDurationMinutes ||
            (block.blockDurationMinutes ?? undefined),
          timeCapMinutes:
            responseBlock?.timeCapMinutes ||
            (block.timeCapMinutes ?? undefined),
          rounds: responseBlock?.rounds || (block.rounds ?? undefined),
          instructions:
            responseBlock?.instructions || (block.instructions ?? undefined),
          order: index,
          created_at: new Date(block.createdAt ?? Date.now()),
          updated_at: new Date(),
          exercises: newExercises.map((ex, exIndex) => ({
            id: ex.id,
            workoutBlockId: ex.workoutBlockId,
            exerciseId: ex.exerciseId,
            sets: ex.sets ?? undefined,
            reps: ex.reps ?? undefined,
            weight: ex.weight ?? undefined,
            duration: ex.duration ?? undefined,
            restTime: ex.restTime ?? undefined,
            completed: ex.completed ?? false,
            notes: ex.notes ?? undefined,
            order: ex.order ?? undefined,
            created_at: new Date(ex.createdAt ?? Date.now()),
            updated_at: new Date(ex.updatedAt ?? Date.now()),
            exercise: {
              id: ex.exercise.id,
              name: ex.exercise.name,
              description: ex.exercise.description ?? undefined,
              category:
                ex.exercise.muscleGroups && ex.exercise.muscleGroups.length > 0
                  ? ex.exercise.muscleGroups[0]
                  : "general",
              difficulty: ex.exercise.difficulty || "beginner",
              equipment: Array.isArray(ex.exercise.equipment)
                ? ex.exercise.equipment.join(", ")
                : (ex.exercise.equipment ?? undefined),
              link: ex.exercise.link ?? undefined,
              muscles_targeted: ex.exercise.muscleGroups || [],
              created_at: new Date(ex.exercise.createdAt ?? Date.now()),
              updated_at: new Date(ex.exercise.updatedAt ?? Date.now()),
            },
          })),
        })),
      };
    } catch (error) {
      // Update progress - daily regeneration failed
      emitProgress(userId, 0, false, (error as Error).message);
      throw error;
    }
  }

  /**
   * Get workout history for a user (all past workouts - completed or not)
   */
  async getWorkoutHistory(userId: number): Promise<WorkoutWithDetails[]> {
    const today = new Date();

    // Get all workouts that are either:
    // 1. Not active (isActive = false)
    // 2. Active but past their end date
    // 3. Completed
    const historicalWorkouts = await this.db.query.workouts.findMany({
      where: and(
        eq(workouts.userId, userId),
        or(
          eq(workouts.isActive, false),
          eq(workouts.completed, true),
          sql`${workouts.endDate}::date < ${today}::date`
        )
      ),
      orderBy: [desc(workouts.endDate)],
      with: {
        planDays: {
          orderBy: [asc(planDays.date)],
          with: {
            blocks: {
              orderBy: [asc(workoutBlocks.order)],
              with: {
                exercises: {
                  orderBy: [asc(planDayExercises.order)],
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return historicalWorkouts.map((workout) =>
      this.transformWorkout(workout as unknown as DBWorkoutResult)
    );
  }

  /**
   * Get list of previous workouts with flexible time filtering
   */
  async getPreviousWorkouts(
    userId: number,
    timeFilter: "week" | "month" | "3months" | "all" = "month"
  ): Promise<any[]> {
    const today = new Date();
    let dateFilter = null;

    if (timeFilter !== "all") {
      const filterDate = new Date();
      switch (timeFilter) {
        case "week":
          filterDate.setDate(filterDate.getDate() - 7);
          break;
        case "month":
          filterDate.setMonth(filterDate.getMonth() - 1);
          break;
        case "3months":
          filterDate.setMonth(filterDate.getMonth() - 3);
          break;
      }
      dateFilter = filterDate;
    }

    const whereConditions = [
      eq(workouts.userId, userId),
      // Exclude truly active workouts (within date range and active)
      not(
        and(
          eq(workouts.isActive, true),
          eq(workouts.completed, false),
          sql`${workouts.startDate}::date <= ${today}::date AND ${workouts.endDate}::date >= ${today}::date`
        )
      ),
    ];

    if (dateFilter) {
      whereConditions.push(gte(workouts.endDate, dateFilter));
    }

    const previousWorkouts = await this.db.query.workouts.findMany({
      where: and(...whereConditions),
      orderBy: [desc(workouts.endDate)],
      with: {
        planDays: {
          orderBy: [asc(planDays.date)],
          with: {
            blocks: {
              with: {
                exercises: true,
              },
            },
          },
        },
      },
    });

    return previousWorkouts.map((workout) => {
      const totalWorkouts = workout.planDays?.length || 0;
      const completedWorkouts =
        workout.planDays?.filter((day) => day.isComplete).length || 0;
      const completionRate =
        totalWorkouts > 0
          ? Math.round((completedWorkouts / totalWorkouts) * 100)
          : 0;

      return {
        id: workout.id,
        name: workout.name,
        description: workout.description,
        startDate: formatDateAsString(workout.startDate),
        endDate: formatDateAsString(workout.endDate),
        totalWorkouts,
        completedWorkouts,
        completionRate,
        duration: this.calculateWorkoutDuration(
          workout.startDate,
          workout.endDate
        ),
        planDays:
          workout.planDays?.map((day, index) => ({
            id: day.id,
            dayNumber: day.dayNumber || index + 1,
            date: formatDateAsString(day.date),
            name: day.name || `Day ${index + 1}`,
            description: day.description,
            isComplete: day.isComplete || false,
            totalExercises:
              day.blocks?.reduce(
                (total, block) => total + (block.exercises?.length || 0),
                0
              ) || 0,
            blocks:
              day.blocks?.map((block) => ({
                id: block.id,
                blockName: block.blockName,
                blockType: block.blockType,
                exerciseCount: block.exercises?.length || 0,
              })) || [],
          })) || [],
      };
    });
  }

  private calculateWorkoutDuration(
    startDate: Date | string,
    endDate: Date | string
  ): string {
    const start =
      typeof startDate === "string" ? new Date(startDate) : startDate;
    const end = typeof endDate === "string" ? new Date(endDate) : endDate;

    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays === 1) return "1 day";
    if (diffDays < 7) return `${diffDays} days`;
    if (diffDays === 7) return "1 week";

    const weeks = Math.floor(diffDays / 7);
    const remainingDays = diffDays % 7;

    if (remainingDays === 0)
      return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
    return `${weeks}w ${remainingDays}d`;
  }

  /**
   * Repeat a previous week's workout with a new start date
   */
  async repeatPreviousWeekWorkout(
    userId: number,
    originalWorkoutId: number,
    newStartDate: string
  ): Promise<WorkoutWithDetails> {
    // Emit 5% - Starting repeat process
    emitProgress(userId, 5);

    // First, deactivate any existing active workouts
    await this.db
      .update(workouts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)));

    // Get the original workout with all its data
    const originalWorkout = await this.db.query.workouts.findFirst({
      where: and(
        eq(workouts.id, originalWorkoutId),
        eq(workouts.userId, userId)
      ),
      with: {
        planDays: {
          orderBy: [asc(planDays.date)],
          with: {
            blocks: {
              orderBy: [asc(workoutBlocks.order)],
              with: {
                exercises: {
                  orderBy: [asc(planDayExercises.order)],
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!originalWorkout) {
      throw new Error("Original workout not found");
    }

    // Emit 20% - Found original workout
    emitProgress(userId, 20);

    // Get user profile to access available workout days
    const profile = await profileService.getProfileByUserId(userId);
    const availableDays = profile?.availableDays || [];

    // Create new workout with 7-day duration
    const newStart = new Date(newStartDate);
    const newEndDate = addDays(newStartDate, 6); // 7 days total (0-6)

    // Emit 40% - Creating new workout
    emitProgress(userId, 40);

    const [newWorkout] = await this.db
      .insert(workouts)
      .values({
        userId,
        name: `${originalWorkout.name}`,
        description: originalWorkout.description,
        startDate: sql`${newStart}::date`,
        endDate: sql`${new Date(newEndDate)}::date`,
        promptId: originalWorkout.promptId, // Copy the prompt ID from original workout
        isActive: true,
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // If user has available days configured, distribute workouts accordingly
    if (availableDays.length > 0) {
      // Emit 60% - Scheduling plan days
      emitProgress(userId, 60);
      
      // Calculate new dates for plan days based on available workout days
      const startDayOfWeek = new Date(newStartDate)
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();
      const daysOfWeek = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      const todayIndex = daysOfWeek.indexOf(startDayOfWeek);

      // Sort available days to start from today
      const sortedAvailable = availableDays
        .map((day) => ({ day, index: daysOfWeek.indexOf(day) }))
        .sort(
          (a, b) =>
            ((a.index - todayIndex + 7) % 7) - ((b.index - todayIndex + 7) % 7)
        )
        .map((obj) => obj.day);

      // Create new plan days with dates based on available workout days
      let referenceDate = newStartDate;
      for (let i = 0; i < (originalWorkout.planDays || []).length; i++) {
        const originalPlanDay = originalWorkout.planDays[i];
        const availableDay = sortedAvailable[i % sortedAvailable.length];
        const scheduledDate = getDateForWeekday(availableDay, referenceDate);

        // Move reference date to the day after the scheduledDate to prevent same day reuse
        referenceDate = addDays(scheduledDate, 1);

        const [newPlanDay] = await this.db
          .insert(planDays)
          .values({
            workoutId: newWorkout.id,
            date: sql`${new Date(scheduledDate)}::date`,
            name: originalPlanDay.name,
            description: originalPlanDay.description,
            instructions: originalPlanDay.instructions,
            isComplete: false, // Reset completion status
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        // Create new workout blocks
        for (const originalBlock of originalPlanDay.blocks || []) {
          const [newBlock] = await this.db
            .insert(workoutBlocks)
            .values({
              planDayId: newPlanDay.id,
              blockType: originalBlock.blockType,
              blockName: originalBlock.blockName,
              blockDurationMinutes: originalBlock.blockDurationMinutes,
              timeCapMinutes: originalBlock.timeCapMinutes,
              rounds: originalBlock.rounds,
              instructions: originalBlock.instructions,
              order: originalBlock.order,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          // Create new plan day exercises
          for (const originalExercise of originalBlock.exercises || []) {
            await this.db.insert(planDayExercises).values({
              workoutBlockId: newBlock.id,
              exerciseId: originalExercise.exerciseId,
              sets: originalExercise.sets,
              reps: originalExercise.reps,
              weight: originalExercise.weight,
              duration: originalExercise.duration,
              restTime: originalExercise.restTime,
              completed: false, // Reset completion status
              notes: originalExercise.notes,
              order: originalExercise.order,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
      }
    } else {
      // No available days configured - just copy with date shift
      const originalStartDate = new Date(originalWorkout.startDate);
      const dateDiff = newStart.getTime() - originalStartDate.getTime();

      for (const originalPlanDay of originalWorkout.planDays || []) {
        const originalDate = new Date(originalPlanDay.date);
        const newDate = new Date(originalDate.getTime() + dateDiff);

        const [newPlanDay] = await this.db
          .insert(planDays)
          .values({
            workoutId: newWorkout.id,
            date: sql`${newDate}::date`,
            name: originalPlanDay.name,
            description: originalPlanDay.description,
            instructions: originalPlanDay.instructions,
            isComplete: false, // Reset completion status
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        // Create new workout blocks
        for (const originalBlock of originalPlanDay.blocks || []) {
          const [newBlock] = await this.db
            .insert(workoutBlocks)
            .values({
              planDayId: newPlanDay.id,
              blockType: originalBlock.blockType,
              blockName: originalBlock.blockName,
              blockDurationMinutes: originalBlock.blockDurationMinutes,
              timeCapMinutes: originalBlock.timeCapMinutes,
              rounds: originalBlock.rounds,
              instructions: originalBlock.instructions,
              order: originalBlock.order,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          // Create new plan day exercises
          for (const originalExercise of originalBlock.exercises || []) {
            await this.db.insert(planDayExercises).values({
              workoutBlockId: newBlock.id,
              exerciseId: originalExercise.exerciseId,
              sets: originalExercise.sets,
              reps: originalExercise.reps,
              weight: originalExercise.weight,
              duration: originalExercise.duration,
              restTime: originalExercise.restTime,
              completed: false, // Reset completion status
              notes: originalExercise.notes,
              order: originalExercise.order,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
      }
    }

    // Emit 85% - Copying workout data
    emitProgress(userId, 85);

    // Fetch and return the newly created workout with all its details
    const createdWorkout = await this.db.query.workouts.findFirst({
      where: eq(workouts.id, newWorkout.id),
      with: {
        planDays: {
          orderBy: [asc(planDays.date)],
          with: {
            blocks: {
              orderBy: [asc(workoutBlocks.order)],
              with: {
                exercises: {
                  orderBy: [asc(planDayExercises.order)],
                  with: {
                    exercise: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!createdWorkout) {
      throw new Error("Failed to fetch created workout");
    }

    // Emit 100% - Complete
    emitProgress(userId, 100, true);

    return this.transformWorkout(createdWorkout as unknown as DBWorkoutResult);
  }
}

export const workoutService = new WorkoutService();

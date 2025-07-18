import { and, asc, desc, eq, sql } from "drizzle-orm";
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
                : exercise.exercise.equipment ?? undefined,
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
          : exercise.equipment ?? undefined,
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
          : exerciseDetails.equipment ?? undefined,
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

    let referenceDate = today;

    for (let i = 0; i < workoutPlan.length; i++) {
      const availableDay = rotatedDays[i % rotatedDays.length];
      const scheduledDate = timezone
        ? getDateForWeekdayInTimezone(availableDay, referenceDate, timezone)
        : getDateForWeekday(availableDay, referenceDate);

      // Move reference date to the day after the scheduledDate to prevent same day reuse
      referenceDate = addDays(scheduledDate, 1);

      const planDay = await this.createPlanDay({
        workoutId: workout.id,
        date: scheduledDate,
        instructions: workoutPlan[i].instructions,
        name: workoutPlan[i].name,
        description: workoutPlan[i].description,
        dayNumber: i,
      });

      // Create blocks for this plan day
      for (
        let blockIndex = 0;
        blockIndex < workoutPlan[i].blocks.length;
        blockIndex++
      ) {
        const block = workoutPlan[i].blocks[blockIndex];
        const workoutBlock = await this.createWorkoutBlock({
          planDayId: planDay.id,
          blockType: block.blockType,
          blockName: block.blockName,
          blockDurationMinutes: block.blockDurationMinutes,
          timeCapMinutes: block.timeCapMinutes,
          rounds: block.rounds,
          instructions: block.instructions,
          order: block.order,
        });

        // Create exercises for this block
        for (
          let exerciseIndex = 0;
          exerciseIndex < block.exercises.length;
          exerciseIndex++
        ) {
          const exercise = block.exercises[exerciseIndex];
          const exerciseDetails = await exerciseService.getExerciseByName(
            exercise.exerciseName
          );
          if (exerciseDetails) {
            await this.createPlanDayExercise({
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
      }
    }

    // Option 1: fetch full workout with planDays and exercises, then transform and return
    const generatedWorkout = await this.getWorkoutById(workout.id);
    if (!generatedWorkout) throw new Error("Workout not found");
    return this.transformWorkout(
      generatedWorkout as unknown as DBWorkoutResult
    );
  }

  async fetchActiveWorkout(userId: number): Promise<WorkoutWithDetails> {
    const workout = await this.db.query.workouts.findFirst({
      where: and(
        eq(workouts.userId, userId),
        eq(workouts.completed, false),
        eq(workouts.isActive, true),
        // sql`${workouts.startDate} <= CURRENT_DATE AND ${workouts.endDate} >= CURRENT_DATE`,
        eq(workouts.completed, false)
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
      throw new Error("No active workout found");
    }

    return this.transformWorkout(workout as unknown as DBWorkoutResult);
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

    // Generate new workout for this day
    const { response } = await promptsService.generateDailyRegenerationPrompt(
      userId,
      (existingPlanDay as any).dayNumber || 1,
      previousWorkout,
      regenerationReason
    );

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
      .where(eq(planDayExercises.workoutBlockId, existingPlanDay.blocks[0].id));

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
    const responseBlock = response.blocks && response.blocks.length > 0 ? response.blocks[0] : null;
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

    // Return the updated plan day with new exercises
    return {
      id: existingPlanDay.id,
      workoutId: existingPlanDay.workoutId,
      date: existingPlanDay.date, // Keep as string to avoid timezone conversion
      instructions: response.instructions ?? undefined,
      name: response.name || existingPlanDay.name || "",
      description: response.description || (existingPlanDay.description ?? undefined),
      dayNumber: existingPlanDay.dayNumber || 1,
      created_at: new Date(existingPlanDay.createdAt ?? Date.now()),
      updated_at: new Date(),
      blocks: existingPlanDay.blocks.map((block, index) => ({
        id: block.id,
        blockType: responseBlock?.blockType || (block.blockType ?? undefined),
        blockName: responseBlock?.blockName || (block.blockName ?? undefined),
        blockDurationMinutes: responseBlock?.blockDurationMinutes || (block.blockDurationMinutes ?? undefined),
        timeCapMinutes: responseBlock?.timeCapMinutes || (block.timeCapMinutes ?? undefined),
        rounds: responseBlock?.rounds || (block.rounds ?? undefined),
        instructions: responseBlock?.instructions || (block.instructions ?? undefined),
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
              : ex.exercise.equipment ?? undefined,
            link: ex.exercise.link ?? undefined,
            muscles_targeted: ex.exercise.muscleGroups || [],
            created_at: new Date(ex.exercise.createdAt ?? Date.now()),
            updated_at: new Date(ex.exercise.updatedAt ?? Date.now()),
          },
        })),
      })),
    };
  }
}

export const workoutService = new WorkoutService();

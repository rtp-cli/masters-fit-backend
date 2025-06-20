import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  workouts,
  planDays,
  planDayExercises,
  exercises,
  exerciseLogs,
  type PlanDay,
  type PlanDayExercise,
  type Exercise,
  type Workout,
  InsertWorkout,
  InsertPlanDay,
  InsertPlanDayExercise,
} from "@/models";
import type {
  WorkoutWithDetails,
  PlanDayWithExercises,
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
  formatDateAsLocalString,
  createTimestamp,
  toUTCDate,
  formatTimestampForAPI,
} from "@/utils/date.utils";
import { workoutLogs } from "../models/logs.schema";

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
    name: string;
    description: string | null;
    dayNumber: number;
    createdAt: Date | null;
    updatedAt: Date | null;
    exercises: Array<{
      id: number;
      planDayId: number;
      exerciseId: number;
      sets: number | null;
      reps: number | null;
      weight: number | null;
      duration: number | null;
      restTime: number | null;
      completed: boolean | null;
      notes: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      exercise: {
        id: number;
        name: string;
        description: string | null;
        muscleGroups: string[];
        difficulty: string;
        equipment: string[] | null;
        link: string | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      };
    }>;
  }>;
};

type DBWorkoutQueryResult = {
  id: number;
  name: string;
  description: string | null;
  userId: number;
  startDate: Date;
  endDate: Date;
  promptId: number;
  isActive: boolean | null;
  completed: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  planDays: Array<{
    id: number;
    workoutId: number;
    date: Date;
    name: string;
    description: string | null;
    dayNumber: number;
    createdAt: Date | null;
    updatedAt: Date | null;
    exercises: Array<{
      id: number;
      planDayId: number;
      exerciseId: number;
      sets: number | null;
      reps: number | null;
      weight: number | null;
      duration: number | null;
      restTime: number | null;
      completed: boolean | null;
      notes: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      exercise: {
        id: number;
        name: string;
        description: string | null;
        muscleGroups: string[];
        difficulty: string;
        equipment: string[] | null;
        link: string | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      };
    }>;
  }>;
};

export class WorkoutService extends BaseService {
  private transformWorkout(workout: DBWorkoutResult): WorkoutWithDetails {
    const transformedWorkout: WorkoutWithDetails = {
      id: workout.id,
      userId: workout.userId,
      name: workout.name,
      description: workout.description ?? undefined,
      startDate: new Date(workout.startDate),
      endDate: new Date(workout.endDate),
      promptId: workout.promptId,
      isActive: workout.isActive ?? false,
      completed: workout.completed ?? false,
      created_at: new Date(workout.createdAt ?? Date.now()),
      updated_at: new Date(workout.updatedAt ?? Date.now()),
      planDays: workout.planDays.map((planDay) => ({
        id: planDay.id,
        workoutId: planDay.workoutId,
        date: new Date(planDay.date),
        name: planDay.name,
        description: planDay.description ?? undefined,
        dayNumber: planDay.dayNumber,
        created_at: new Date(planDay.createdAt ?? Date.now()),
        updated_at: new Date(planDay.updatedAt ?? Date.now()),
        exercises: planDay.exercises.map((exercise) => ({
          id: exercise.id,
          planDayId: exercise.planDayId,
          exerciseId: exercise.exerciseId,
          sets: exercise.sets ?? undefined,
          reps: exercise.reps ?? undefined,
          weight: exercise.weight ?? undefined,
          duration: exercise.duration ?? undefined,
          restTime: exercise.restTime ?? undefined,
          completed: exercise.completed ?? false,
          notes: exercise.notes ?? undefined,
          created_at: new Date(exercise.createdAt ?? Date.now()),
          updated_at: new Date(exercise.updatedAt ?? Date.now()),
          exercise: {
            id: exercise.exercise.id,
            name: exercise.exercise.name,
            description: exercise.exercise.description ?? undefined,
            category: exercise.exercise.muscleGroups[0],
            difficulty: exercise.exercise.difficulty || "beginner",
            equipment: exercise.exercise.equipment?.join(", ") ?? undefined,
            link: exercise.exercise.link || undefined,
            muscles_targeted: exercise.exercise.muscleGroups,
            created_at: new Date(exercise.exercise.createdAt ?? Date.now()),
            updated_at: new Date(exercise.exercise.updatedAt ?? Date.now()),
          },
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
            exercises: {
              with: {
                exercise: true,
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
            exercises: {
              with: {
                exercise: true,
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
        startDate: workout.startDate
          ? formatDateAsLocalString(workout.startDate)
          : formatDateAsLocalString(new Date()),
        endDate: workout.endDate
          ? formatDateAsLocalString(workout.endDate)
          : formatDateAsLocalString(new Date()),
        promptId: workout.promptId,
        isActive: workout.isActive,
        completed: workout.completed,
        createdAt: workout.createdAt,
        updatedAt: workout.updatedAt,
        planDays: workout.planDays.map((pd) => ({
          id: pd.id,
          workoutId: pd.workoutId,
          date: pd.date
            ? formatDateAsLocalString(pd.date)
            : formatDateAsLocalString(new Date()),
          name: pd.name || "",
          description: pd.description,
          dayNumber: pd.dayNumber || 1,
          createdAt: pd.createdAt,
          updatedAt: pd.updatedAt,
          exercises: pd.exercises.map((ex) => ({
            id: ex.id,
            planDayId: ex.planDayId,
            exerciseId: ex.exerciseId,
            sets: ex.sets,
            reps: ex.reps,
            weight: ex.weight,
            duration: ex.duration,
            restTime: ex.restTime,
            completed: ex.completed,
            notes: ex.notes,
            createdAt: ex.createdAt,
            updatedAt: ex.updatedAt,
            exercise: {
              id: ex.exercise.id,
              name: ex.exercise.name,
              description: ex.exercise.description,
              muscleGroups: ex.exercise.muscleGroups,
              difficulty: ex.exercise.difficulty || "beginner",
              equipment: ex.exercise.equipment,
              link: ex.exercise.link || null,
              createdAt: ex.exercise.createdAt,
              updatedAt: ex.exercise.updatedAt,
            },
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
            exercises: {
              with: {
                exercise: true,
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
        startDate: workout.startDate
          ? formatDateAsLocalString(workout.startDate)
          : formatDateAsLocalString(new Date()),
        endDate: workout.endDate
          ? formatDateAsLocalString(workout.endDate)
          : formatDateAsLocalString(new Date()),
        promptId: workout.promptId,
        isActive: workout.isActive,
        completed: workout.completed,
        createdAt: workout.createdAt,
        updatedAt: workout.updatedAt,
        planDays: workout.planDays.map((pd) => ({
          id: pd.id,
          workoutId: pd.workoutId,
          date: pd.date
            ? formatDateAsLocalString(pd.date)
            : formatDateAsLocalString(new Date()),
          name: pd.name || "",
          description: pd.description,
          dayNumber: pd.dayNumber || 1,
          createdAt: pd.createdAt,
          updatedAt: pd.updatedAt,
          exercises: pd.exercises.map((ex) => ({
            id: ex.id,
            planDayId: ex.planDayId,
            exerciseId: ex.exerciseId,
            sets: ex.sets,
            reps: ex.reps,
            weight: ex.weight,
            duration: ex.duration,
            restTime: ex.restTime,
            completed: ex.completed,
            notes: ex.notes,
            createdAt: ex.createdAt,
            updatedAt: ex.updatedAt,
            exercise: {
              id: ex.exercise.id,
              name: ex.exercise.name,
              description: ex.exercise.description,
              muscleGroups: ex.exercise.muscleGroups,
              difficulty: ex.exercise.difficulty || "beginner",
              equipment: ex.exercise.equipment,
              link: ex.exercise.link || null,
              createdAt: ex.exercise.createdAt,
              updatedAt: ex.exercise.updatedAt,
            },
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
            exercises: {
              with: {
                exercise: true,
              },
            },
          },
        },
      },
    });

    if (!updatedWorkout) {
      throw new Error("Updated workout not found");
    }

    return this.transformWorkout(updatedWorkout);
  }

  async createPlanDay(data: InsertPlanDay): Promise<PlanDayWithExercises> {
    const now = createTimestamp();
    const [planDay] = await this.db
      .insert(planDays)
      .values({
        ...data,
        date: sql`${data.date}::date`,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      id: planDay.id,
      workoutId: planDay.workoutId,
      date: new Date(planDay.date),
      name: "",
      description: undefined,
      dayNumber: 1,
      created_at: now,
      updated_at: now,
      exercises: [],
    };
  }

  async createPlanDayExercise(
    data: InsertPlanDayExercise
  ): Promise<PlanDayWithExercise> {
    const now = new Date();
    const [exercise] = await this.db
      .insert(planDayExercises)
      .values({
        ...data,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const exerciseDetails = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, data.exerciseId),
    });

    if (!exerciseDetails) {
      throw new Error("Exercise not found");
    }

    return {
      id: exercise.id,
      planDayId: exercise.planDayId,
      exerciseId: exercise.exerciseId,
      sets: exercise.sets ?? undefined,
      reps: exercise.reps ?? undefined,
      weight: exercise.weight ?? undefined,
      duration: exercise.duration ?? undefined,
      restTime: exercise.restTime ?? undefined,
      completed: exercise.completed ?? false,
      notes: undefined,
      created_at: now,
      updated_at: now,
      exercise: {
        id: exerciseDetails.id,
        name: exerciseDetails.name,
        description: exerciseDetails.description ?? undefined,
        category: exerciseDetails.muscleGroups[0],
        difficulty: exerciseDetails.difficulty || "beginner",
        equipment: exerciseDetails.equipment?.join(", ") ?? undefined,
        link: exerciseDetails.link ?? undefined,
        muscles_targeted: exerciseDetails.muscleGroups,
        created_at: exerciseDetails.createdAt ?? now,
        updated_at: exerciseDetails.updatedAt ?? now,
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
        ...(data.sets !== undefined && { sets: data.sets || null }),
        ...(data.reps !== undefined && { reps: data.reps || null }),
        ...(data.weight !== undefined && { weight: data.weight || null }),
        ...(data.duration !== undefined && { duration: data.duration || null }),
        ...(data.restTime !== undefined && { restTime: data.restTime || null }),
      })
      .where(eq(planDayExercises.id, id))
      .returning();

    if (!exercise) {
      throw new Error("Exercise not found");
    }

    const exerciseDetails = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, exercise.exerciseId),
    });

    if (!exerciseDetails) {
      throw new Error("Exercise not found");
    }

    return {
      id: exercise.id,
      planDayId: exercise.planDayId,
      exerciseId: exercise.exerciseId,
      sets: exercise.sets ?? undefined,
      reps: exercise.reps ?? undefined,
      weight: exercise.weight ?? undefined,
      duration: exercise.duration ?? undefined,
      restTime: exercise.restTime ?? undefined,
      completed: exercise.completed ?? false,
      notes: undefined,
      created_at: new Date(),
      updated_at: new Date(),
      exercise: {
        id: exerciseDetails.id,
        name: exerciseDetails.name,
        description: exerciseDetails.description ?? undefined,
        category: exerciseDetails.muscleGroups[0],
        difficulty: exerciseDetails.difficulty || "beginner",
        equipment: exerciseDetails.equipment?.join(", ") ?? undefined,
        link: exerciseDetails.link ?? undefined,
        muscles_targeted: exerciseDetails.muscleGroups,
        created_at: new Date(),
        updated_at: new Date(),
      },
    };
  }

  async getWorkoutById(id: number): Promise<DBWorkoutResult> {
    const workout = await this.db.query.workouts.findFirst({
      where: eq(workouts.id, id),
      with: {
        planDays: {
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
    return workout as unknown as DBWorkoutResult;
  }

  async generateWorkoutPlan(
    userId: number,
    customFeedback?: string
  ): Promise<WorkoutWithDetails> {
    const { response, promptId } = await promptsService.generatePrompt(
      userId,
      customFeedback
    );
    const profile = await profileService.getProfileByUserId(userId);
    // Calculate startDate and endDate as YYYY-MM-DD strings (local date, no timezone shift)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toLocaleDateString("en-CA");

    const end = new Date(today);
    end.setDate(end.getDate() + 6);
    end.setHours(0, 0, 0, 0);
    const endDate = end.toLocaleDateString("en-CA");

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
    const currentDay = new Date();
    currentDay.setHours(0, 0, 0, 0);
    const todayDay = currentDay
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

    const getNextDateForDay = (targetDay: string, afterDate: Date): Date => {
      const daysOfWeek = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      const targetIndex = daysOfWeek.indexOf(targetDay.toLowerCase());

      const result = new Date(afterDate);
      result.setHours(0, 0, 0, 0); // ✅ add this to avoid time-based mismatch

      while (result.getDay() !== targetIndex) {
        result.setDate(result.getDate() + 1);
      }

      return result;
    };

    let referenceDate = new Date(currentDay);
    referenceDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < workoutPlan.length; i++) {
      const availableDay = rotatedDays[i % rotatedDays.length];
      const scheduledDate = getNextDateForDay(availableDay, referenceDate);

      // Move reference date to the day *after* the scheduledDate to prevent same day reuse
      referenceDate = new Date(scheduledDate.getTime());
      referenceDate.setDate(referenceDate.getDate() + 1);

      const planDay = await this.createPlanDay({
        workoutId: workout.id,
        date: scheduledDate.toLocaleDateString("en-CA"),
      });

      for (const exercise of workoutPlan[i].exercises) {
        const exerciseDetails = await exerciseService.getExerciseByName(
          exercise.exerciseName
        );
        if (exerciseDetails) {
          await this.createPlanDayExercise({
            planDayId: planDay.id,
            exerciseId: exerciseDetails.id,
            sets: exercise.sets,
            reps: exercise.reps,
            weight: exercise.weight,
            duration: exercise.duration,
            restTime: exercise.restTime,
            notes: exercise.notes,
          });
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
            exercises: {
              with: {
                exercise: true,
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
    // If profile data is provided, update the user's profile first
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
      console.log(
        `Found ${activeWorkouts.length} active workout(s) for user ${userId}:`,
        activeWorkouts.map((w) => `ID: ${w.id}, Name: ${w.name}`)
      );

      // Deactivate all current active workouts
      const updateResult = await this.db
        .update(workouts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)));

      console.log(
        `Successfully deactivated active workouts for user ${userId}`
      );
    } else {
      console.log(`No active workouts found for user ${userId}`);
    }

    // Generate the new workout plan
    const workout = await this.generateWorkoutPlan(userId, customFeedback);
    console.log(
      `Generated new workout plan with ID ${workout.id} for user ${userId}`
    );

    return workout;
  }

  async regenerateDailyWorkout(
    userId: number,
    planDayId: number,
    regenerationReason: string
  ): Promise<PlanDayWithExercises> {
    // Get the existing plan day with its exercises
    const existingPlanDay = await this.db.query.planDays.findFirst({
      where: eq(planDays.id, planDayId),
      with: {
        exercises: {
          with: {
            exercise: true,
          },
        },
      },
    });

    if (!existingPlanDay) {
      throw new Error("Plan day not found");
    }

    // Format the previous workout for the AI prompt
    const previousWorkout = {
      day: (existingPlanDay as any).dayNumber || 1,
      exercises: existingPlanDay.exercises.map((ex) => ({
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
    const planDayExerciseIds = existingPlanDay.exercises.map((ex) => ex.id);
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
      .where(eq(planDayExercises.planDayId, planDayId));

    // Create new exercises for this plan day
    const newExercises = [];
    for (const exercise of response.exercises) {
      const exerciseDetails = await exerciseService.getExerciseByName(
        exercise.exerciseName
      );
      if (exerciseDetails) {
        const newExercise = await this.createPlanDayExercise({
          planDayId: planDayId,
          exerciseId: exerciseDetails.id,
          sets: exercise.sets,
          reps: exercise.reps,
          weight: exercise.weight,
          duration: exercise.duration,
          restTime: exercise.restTime,
          notes: exercise.notes,
        });
        newExercises.push(newExercise);
      }
    }

    // Return the updated plan day with new exercises
    return {
      id: existingPlanDay.id,
      workoutId: existingPlanDay.workoutId,
      date: new Date(existingPlanDay.date),
      name: (existingPlanDay as any).name || "",
      description: (existingPlanDay as any).description ?? undefined,
      dayNumber: (existingPlanDay as any).dayNumber || 1,
      created_at: new Date(existingPlanDay.createdAt ?? Date.now()),
      updated_at: new Date(),
      exercises: newExercises,
    };
  }
}

export const workoutService = new WorkoutService();

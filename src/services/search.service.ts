import { eq, sql, and, ilike } from "drizzle-orm";
import {
  workouts,
  planDays,
  workoutBlocks,
  planDayExercises,
  exercises,
  exerciseLogs,
  exerciseSetLogs,
  workoutLogs,
  type Exercise,
  type PlanDay,
  type WorkoutBlock,
  type PlanDayExercise,
  type ExerciseLog,
  type ExerciseSetLog,
} from "@/models";
import { BaseService } from "./base.service";
import { logger } from "@/utils/logger";
import { AvailableEquipment, IntensityLevels } from "@/constants/profile";

// Simple response types
interface DateSearchResponse {
  success: boolean;
  date: string;
  workout: any | null;
}

interface ExerciseSearchResponse {
  success: boolean;
  exercise: any;
  userStats: any | null;
}

export class SearchService extends BaseService {
  /**
   * Search for workout by specific date
   */
  async searchByDate(
    userId: number,
    dateString: string
  ): Promise<DateSearchResponse> {
    try {
      const searchDate = new Date(dateString);

      // First, find all workouts for this user
      const userWorkouts = await this.db.query.workouts.findMany({
        where: eq(workouts.userId, userId),
        columns: { id: true },
      });

      if (userWorkouts.length === 0) {
        return {
          success: true,
          date: dateString,
          workout: null,
        };
      }

      // Find plan day for the specific date from user's workouts
      const workoutIds = userWorkouts.map((w) => w.id);

      const planDay = await this.db.query.planDays.findFirst({
        where: and(
          sql`${planDays.workoutId} IN (${sql.join(workoutIds, sql`, `)})`,
          eq(planDays.date, dateString)
        ),
        with: {
          workout: true,
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
        orderBy: (planDays, { desc }) => [desc(planDays.workoutId)],
      });

      if (!planDay) {
        return {
          success: true,
          date: dateString,
          workout: null,
        };
      }

      // Get exercise logs for completion tracking
      const exerciseIds = planDay.blocks.flatMap((block) =>
        block.exercises.map((ex) => ex.id)
      );
      const logs =
        exerciseIds.length > 0
          ? await this.db.query.exerciseLogs.findMany({
              where: sql`plan_day_exercise_id IN (${sql.join(
                exerciseIds,
                sql`, `
              )})`,
            })
          : [];

      // Get set logs for each exercise log
      const logIds = logs.map(log => log.id);
      const setLogs = logIds.length > 0
        ? await this.db.query.exerciseSetLogs.findMany({
            where: sql`exercise_log_id IN (${sql.join(logIds, sql`, `)})`
          })
        : [];

      // Group set logs by exercise log id
      const setLogsByExerciseLogId = setLogs.reduce((acc, setLog) => {
        if (!acc[setLog.exerciseLogId]) {
          acc[setLog.exerciseLogId] = [];
        }
        acc[setLog.exerciseLogId].push(setLog);
        return acc;
      }, {} as Record<number, typeof setLogs>);

      // Calculate completion rates for each exercise
      const blocksWithExercises = planDay.blocks.map((block) => ({
        ...block,
        exercises: block.exercises.map((planExercise) => {
          const exerciseLog = logs.find(
            (log) => log.planDayExerciseId === planExercise.id
          );

          let completionRate = 0;
          if (exerciseLog && planExercise.sets && planExercise.reps) {
            const plannedVolume = planExercise.sets * planExercise.reps;
            const exerciseSetLogs = setLogsByExerciseLogId[exerciseLog.id] || [];
            const completedVolume = exerciseSetLogs
              .reduce((sum, setLog) => sum + (setLog.reps || 0), 0);
            completionRate = Math.round(
              (completedVolume / plannedVolume) * 100
            );
          }

          return {
            id: planExercise.id,
            exercise: {
              id: planExercise.exercise.id,
              name: planExercise.exercise.name,
              description: planExercise.exercise.description || "",
              muscleGroups: planExercise.exercise.muscleGroups,
              equipment: planExercise.exercise.equipment || [],
              difficulty: planExercise.exercise.difficulty || "beginner",
              instructions: planExercise.exercise.instructions,
              link: planExercise.exercise.link || undefined,
            },
            sets: planExercise.sets,
            reps: planExercise.reps,
            weight: planExercise.weight,
            duration: planExercise.duration,
            completed: exerciseLog?.isComplete || false,
            completionRate,
          };
        }),
      }));

      // Calculate overall completion rate
      const totalPlannedExercises = blocksWithExercises.reduce(
        (total, block) => total + block.exercises.length,
        0
      );
      const completedExercises = blocksWithExercises.reduce(
        (total, block) =>
          total + block.exercises.filter((e) => e.completed).length,
        0
      );
      const overallCompletionRate =
        totalPlannedExercises > 0
          ? Math.round((completedExercises / totalPlannedExercises) * 100)
          : 0;

      const searchResult = {
        id: planDay.workout.id,
        name: planDay.workout.name,
        description: planDay.workout.description || "",
        completed: planDay.workout.completed || false,
        planDay: {
          id: planDay.id,
          date: searchDate,
          name: planDay.name,
          description: planDay.description,
          dayNumber: planDay.dayNumber,
          instructions: planDay.instructions,
          blocks: blocksWithExercises,
        },
        overallCompletionRate,
      };

      return {
        success: true,
        date: dateString,
        workout: searchResult,
      };
    } catch (error) {
      logger.error("Error searching workouts by date", error as Error, {
        operation: "searchWorkoutsByDate",
        metadata: { userId },
      });
      throw new Error("Failed to search by date");
    }
  }

  /**
   * Search for exercise with user statistics
   */
  async searchExercise(
    userId: number,
    exerciseId: number
  ): Promise<ExerciseSearchResponse> {
    try {
      // Get exercise details
      const exercise = await this.db.query.exercises.findFirst({
        where: eq(exercises.id, exerciseId),
      });

      if (!exercise) {
        throw new Error("Exercise not found");
      }

      // Get user's workout history with this exercise
      const userPlanExercises = await this.db
        .select({
          planDayExercise: planDayExercises,
          exerciseLog: exerciseLogs,
          workoutBlock: workoutBlocks,
          planDay: planDays,
          workout: workouts,
        })
        .from(planDayExercises)
        .leftJoin(
          exerciseLogs,
          eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
        )
        .leftJoin(
          workoutBlocks,
          eq(planDayExercises.workoutBlockId, workoutBlocks.id)
        )
        .leftJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
        .leftJoin(workouts, eq(planDays.workoutId, workouts.id))
        .where(
          and(
            eq(planDayExercises.exerciseId, exerciseId),
            eq(workouts.userId, userId)
          )
        );

      let userStats = null;

      if (userPlanExercises.length > 0) {
        const completedExercises = userPlanExercises.filter(
          (item) => item.exerciseLog?.isComplete
        );
        const totalAssignments = userPlanExercises.length;
        const totalCompletions = completedExercises.length;
        const completionRate = Math.round(
          (totalCompletions / totalAssignments) * 100
        );

        // Get all set logs for completed exercises
        const completedLogIds = completedExercises
          .map((item) => item.exerciseLog?.id)
          .filter((id): id is number => id !== undefined && id !== null);

        const allSetLogs = completedLogIds.length > 0
          ? await this.db.query.exerciseSetLogs.findMany({
              where: sql`exercise_log_id IN (${sql.join(completedLogIds, sql`, `)})`
            })
          : [];

        // Use all sets
        const workingSets = allSetLogs;

        // Calculate averages from completed exercises
        const totalSets = workingSets.length;
        const totalReps = workingSets.reduce((sum, setLog) => sum + (setLog.reps || 0), 0);
        const totalWeight = workingSets.reduce((sum, setLog) => sum + (Number(setLog.weight) || 0), 0);
        
        const averageSets = completedExercises.length > 0
          ? totalSets / completedExercises.length
          : 0;
        const averageReps = totalSets > 0
          ? totalReps / totalSets
          : 0;
        const averageWeight = workingSets.filter(s => s.weight).length > 0
          ? totalWeight / workingSets.filter(s => s.weight).length
          : null;

        // Find personal records
        const maxWeight = workingSets.length > 0
          ? Math.max(...workingSets.map((setLog) => Number(setLog.weight) || 0)) || null
          : null;
        const maxReps = workingSets.length > 0
          ? Math.max(...workingSets.map((setLog) => setLog.reps || 0))
          : 0;
        
        // Max sets per session
        const setsByExerciseLog: Record<number, number> = {};
        workingSets.forEach(setLog => {
          setsByExerciseLog[setLog.exerciseLogId] = (setsByExerciseLog[setLog.exerciseLogId] || 0) + 1;
        });
        const maxSets = Object.keys(setsByExerciseLog).length > 0
          ? Math.max(...Object.values(setsByExerciseLog))
          : 0;

        // Find last performed date
        const lastPerformed = completedExercises.length > 0
          ? new Date(
              Math.max(
                ...completedExercises.map((item) => item.exerciseLog!.createdAt.getTime())
              )
            )
          : null;

        userStats = {
          totalAssignments,
          totalCompletions,
          completionRate,
          averageSets: Math.round(averageSets * 10) / 10,
          averageReps: Math.round(averageReps * 10) / 10,
          averageWeight: averageWeight
            ? Math.round(averageWeight * 10) / 10
            : null,
          lastPerformed,
          personalRecord: {
            maxWeight,
            maxReps,
            maxSets,
          },
        };
      }

      return {
        success: true,
        exercise: {
          id: exercise.id,
          name: exercise.name,
          description: exercise.description || "",
          muscleGroups: exercise.muscleGroups,
          equipment: exercise.equipment || [],
          difficulty: exercise.difficulty || "beginner",
          instructions: exercise.instructions,
          link: exercise.link || undefined,
          created_at: exercise.createdAt,
          updated_at: exercise.updatedAt,
        },
        userStats,
      };
    } catch (error) {
      logger.error("Error searching exercise", error as Error, {
        operation: "searchExercise",
      });
      throw new Error("Failed to search exercise");
    }
  }

  /**
   * Search exercises by name or muscle group
   */
  async searchExercises(query: string): Promise<Exercise[]> {
    try {
      const searchTerm = `%${query.toLowerCase()}%`;

      const results = await this.db.query.exercises.findMany({
        where: sql`
          LOWER(${exercises.name}) LIKE ${searchTerm} OR
          LOWER(${exercises.description}) LIKE ${searchTerm} OR
          EXISTS (
            SELECT 1 FROM unnest(${exercises.muscleGroups}) AS muscle_group
            WHERE LOWER(muscle_group) LIKE ${searchTerm}
          )
        `,
        limit: 20,
      });

      return results;
    } catch (error) {
      logger.error("Error searching exercises", error as Error, {
        operation: "searchExercises",
      });
      throw new Error("Failed to search exercises");
    }
  }

  /**
   * Enhanced search exercises with filtering options
   */
  async searchExercisesWithFilters(
    userId: number,
    options: {
      query?: string;
      muscleGroups?: string[];
      equipment?: string[];
      difficulty?: string;
      excludeId?: number;
      userEquipmentOnly?: boolean;
      limit?: number;
    }
  ): Promise<{
    exercises: Exercise[];
    appliedFilters: {
      equipment?: string[];
      difficulty?: string;
      userEquipmentOnly?: boolean;
    };
  }> {
    try {
      const {
        query,
        muscleGroups,
        equipment,
        difficulty,
        excludeId,
        userEquipmentOnly = true,
        limit = 20,
      } = options;

      // Get user's equipment if auto-filtering is enabled
      let userEquipment: string[] = [];
      if (userEquipmentOnly) {
        const { profileService } = await import("./profile.service");
        const userProfile = await profileService.getProfileByUserId(userId);
        if (userProfile?.equipment) {
          userEquipment = Array.isArray(userProfile.equipment)
            ? userProfile.equipment
            : [];
        }
      }

      // Build WHERE conditions
      const conditions: any[] = [];

      // Text search
      if (query) {
        const searchTerm = `%${query.toLowerCase()}%`;
        conditions.push(sql`
          LOWER(${exercises.name}) LIKE ${searchTerm} OR
          LOWER(${exercises.description}) LIKE ${searchTerm} OR
          EXISTS (
            SELECT 1 FROM unnest(${exercises.muscleGroups}) AS muscle_group
            WHERE LOWER(muscle_group) LIKE ${searchTerm}
          )
        `);
      }

      // Muscle groups filter
      if (muscleGroups && muscleGroups.length > 0) {
        conditions.push(sql`
          EXISTS (
            SELECT 1 FROM unnest(${exercises.muscleGroups}) AS muscle_group
            WHERE muscle_group = ANY(${sql.raw(`ARRAY[${muscleGroups.map(g => `'${g}'`).join(',')}]`)})
          )
        `);
      }

      // Equipment filter (user's equipment or manual override)
      const equipmentToFilter = (!userEquipmentOnly && equipment && equipment.length > 0) ? equipment : (userEquipmentOnly ? userEquipment : []);
      if (equipmentToFilter.length > 0) {
        // Check if bodyweight is specifically selected
        const includesBodyweight = equipmentToFilter.includes('bodyweight');

        if (includesBodyweight) {
          // If bodyweight is selected, include exercises with no equipment OR exercises that use selected equipment
          conditions.push(sql`
            (
              ${exercises.equipment} IS NULL OR
              cardinality(${exercises.equipment}) = 0 OR
              EXISTS (
                SELECT 1 FROM unnest(${exercises.equipment}) AS exercise_equipment
                WHERE exercise_equipment = ANY(${sql.raw(`ARRAY[${equipmentToFilter.map(e => `'${e}'`).join(',')}]`)})
              )
            )
          `);
        } else {
          // If bodyweight is NOT selected, only include exercises that specifically require the selected equipment
          conditions.push(sql`
            EXISTS (
              SELECT 1 FROM unnest(${exercises.equipment}) AS exercise_equipment
              WHERE exercise_equipment = ANY(${sql.raw(`ARRAY[${equipmentToFilter.map(e => `'${e}'`).join(',')}]`)})
            )
          `);
        }
      }

      // Difficulty filter
      if (difficulty) {
        conditions.push(sql`${exercises.difficulty} = ${difficulty}`);
      }

      // Exclude specific exercise
      if (excludeId) {
        conditions.push(sql`${exercises.id} != ${excludeId}`);
      }

      // Combine all conditions
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const results = await this.db.query.exercises.findMany({
        where: whereClause,
        limit,
        orderBy: (exercises, { asc }) => [asc(exercises.name)],
      });

      return {
        exercises: results,
        appliedFilters: {
          equipment: userEquipmentOnly ? userEquipment : equipment,
          difficulty,
          userEquipmentOnly,
        },
      };
    } catch (error) {
      logger.error("Error searching exercises with filters", error as Error, {
        operation: "searchExercisesWithFilters",
        metadata: { userId, options },
      });
      throw new Error("Failed to search exercises with filters");
    }
  }

  /**
   * Get available filter options for exercise search
   */
  async getFilterOptions(): Promise<{
    equipment: string[];
    muscleGroups: string[];
    difficulty: string[];
  }> {
    try {
      // Get all available equipment from the enum
      const equipment = Object.values(AvailableEquipment);

      // Get unique muscle groups from existing exercises
      const muscleGroupsQuery = await this.db.selectDistinct({
        muscleGroup: sql<string>`unnest(muscle_groups)`,
      }).from(exercises);

      const muscleGroups = muscleGroupsQuery
        .map(row => row.muscleGroup)
        .filter(Boolean)
        .filter(group => {
          // Clean up the data - remove invalid entries
          const cleanGroup = group.trim().toLowerCase();

          // Skip empty, malformed, or invalid entries
          if (!cleanGroup || cleanGroup.length < 2) return false;
          if (cleanGroup.includes(',')) return false; // Skip comma-separated entries
          if (cleanGroup.match(/^\d+$/)) return false; // Skip pure numbers
          if (cleanGroup.includes('null') || cleanGroup.includes('undefined')) return false;

          return true;
        })
        .map(group => group.trim()) // Clean whitespace
        .sort();

      // Get all difficulty levels from the enum
      const difficulty = Object.values(IntensityLevels);

      return {
        equipment,
        muscleGroups,
        difficulty,
      };
    } catch (error) {
      logger.error("Error getting filter options", error as Error, {
        operation: "getFilterOptions",
      });
      throw new Error("Failed to get filter options");
    }
  }
}

export const searchService = new SearchService();

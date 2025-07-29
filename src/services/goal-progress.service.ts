import { db } from "@/config/database";
import {
  exerciseLogs,
  exerciseSetLogs,
  exercises,
  planDayExercises,
  planDays,
  workouts,
  workoutBlocks,
  profiles,
} from "@/models";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { FitnessGoals } from "@/constants/profile";
import { GoalProgress, MuscleGroupGoalMapping } from "@/types/dashboard/types";
import { getDateRangeUTC } from "@/utils/date.utils";

export class GoalProgressService {
  // Muscle group mappings for each fitness goal
  private static readonly muscleGroupMappings: MuscleGroupGoalMapping = {
    [FitnessGoals.GENERAL_FITNESS]: [
      "full_body",
      "full body",
      "cardiovascular",
      "core",
      "legs",
      "chest",
      "back",
      "shoulders",
    ],
    [FitnessGoals.FAT_LOSS]: [
      "core",
      "legs",
      "full_body",
      "full body",
      "cardiovascular",
      "cardio",
    ],
    [FitnessGoals.ENDURANCE]: [
      "cardiovascular",
      "legs",
      "core",
      "full_body",
      "full body",
      "cardio",
    ],
    [FitnessGoals.MUSCLE_GAIN]: [
      "chest",
      "back",
      "shoulders",
      "biceps",
      "triceps",
      "legs",
      "quadriceps",
      "glutes",
      "hamstrings",
    ],
    [FitnessGoals.STRENGTH]: [
      "chest",
      "back",
      "legs",
      "core",
      "shoulders",
      "quadriceps",
      "glutes",
      "hamstrings",
      "biceps",
      "triceps",
    ],
    [FitnessGoals.MOBILITY_FLEXIBILITY]: [
      "full_body",
      "full body",
      "core",
      "back",
      "shoulders",
      "hips",
    ],
    [FitnessGoals.BALANCE]: ["core", "legs", "glutes", "ankles"],
    [FitnessGoals.RECOVERY]: ["full_body", "full body", "core", "respiratory"],
  };

  async getGoalProgress(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<GoalProgress[]> {
    // Get user's fitness goal
    const userProfile = await db
      .select({
        goals: profiles.goals,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    if (userProfile.length === 0) {
      return [];
    }

    const userGoals = userProfile[0].goals || [];

    // Build basic conditions
    const whereConditions = [eq(workouts.userId, userId)];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);
      whereConditions.push(gte(exerciseLogs.createdAt, start));
      whereConditions.push(lte(exerciseLogs.createdAt, end));
    }

    const goalProgressData: GoalProgress[] = [];

    for (const goal of userGoals) {
      const relevantMuscleGroups =
        GoalProgressService.muscleGroupMappings[
          goal as keyof MuscleGroupGoalMapping
        ] || [];

      if (relevantMuscleGroups.length === 0) {
        goalProgressData.push({
          goal,
          progressScore: 0,
          totalSets: 0,
          totalReps: 0,
          totalWeight: 0,
          completedWorkouts: 0,
        });
        continue;
      }

      // Get exercises that target relevant muscle groups
      const goalSpecificData = await db
        .select({
          totalSets: sql<number>`COUNT(DISTINCT ${exerciseSetLogs.id})`,
          totalReps: sql<number>`SUM(COALESCE(${exerciseSetLogs.reps}, 0))`,
          totalWeight: sql<number>`SUM(
            CASE 
              WHEN ${exerciseSetLogs.weight} > 0 THEN 
                ${exerciseSetLogs.reps} * ${exerciseSetLogs.weight}
              ELSE 0
            END
          )`,
          completedWorkouts: sql<number>`COUNT(DISTINCT ${planDays.workoutId})`,
        })
        .from(exerciseSetLogs)
        .innerJoin(
          exerciseLogs,
          eq(exerciseSetLogs.exerciseLogId, exerciseLogs.id)
        )
        .innerJoin(
          planDayExercises,
          eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
        )
        .innerJoin(
          workoutBlocks,
          eq(planDayExercises.workoutBlockId, workoutBlocks.id)
        )
        .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
        .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
        .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
        .where(
          and(
            ...whereConditions,
            sql`EXISTS (
              SELECT 1 
              FROM unnest(${exercises.muscleGroups}) AS muscle_group 
              WHERE muscle_group = ANY(ARRAY[${sql.join(
                relevantMuscleGroups.map((group) => sql`${group}`),
                sql`, `
              )}])
            )`
          )
        );

      const goalData = goalSpecificData[0];

      // Calculate progress score based on activity level
      const totalSets = goalData?.totalSets || 0;
      const totalReps = goalData?.totalReps || 0;
      const totalWeight = goalData?.totalWeight || 0;
      const completedWorkouts = goalData?.completedWorkouts || 0;

      // Simple scoring algorithm - can be enhanced based on specific goals
      let progressScore = 0;

      switch (goal) {
        case FitnessGoals.STRENGTH:
          // Emphasize weight progression and compound movements
          progressScore = Math.min(100, totalWeight / 100 + totalSets * 2);
          break;
        case FitnessGoals.ENDURANCE:
          // Emphasize volume and consistency
          progressScore = Math.min(100, totalReps / 10 + completedWorkouts * 5);
          break;
        case FitnessGoals.FAT_LOSS:
          // Emphasize consistency and cardio volume
          progressScore = Math.min(100, totalReps / 8 + completedWorkouts * 6);
          break;
        case FitnessGoals.MUSCLE_GAIN:
          // Balance between volume and weight
          progressScore = Math.min(100, totalWeight / 80 + totalReps / 15);
          break;
        default:
          // General fitness - balanced approach
          progressScore = Math.min(100, totalSets * 3 + completedWorkouts * 4);
      }

      goalProgressData.push({
        goal,
        progressScore: Math.round(progressScore),
        totalSets,
        totalReps,
        totalWeight: Number(totalWeight) || 0,
        completedWorkouts,
      });
    }

    return goalProgressData;
  }
}

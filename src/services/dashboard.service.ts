import { db } from "@/config/database";
import {
  workouts,
  planDays,
  planDayExercises,
  exerciseLogs,
  workoutLogs,
  exercises,
  profiles,
} from "@/models";
import { eq, and, gte, lte, desc, sql, asc, count } from "drizzle-orm";
import { FitnessGoals } from "@/constants/profile";
import {
  WeeklySummary,
  WorkoutConsistency,
  WeightMetrics,
  WeightAccuracyMetrics,
  GoalProgress,
  DashboardMetrics,
  MuscleGroupGoalMapping,
  TotalVolumeMetrics,
} from "@/types/dashboard/types";
import { BaseService } from "@/services/base.service";
import {
  getDateRangeUTC,
  formatDateForDisplay,
  getCurrentUTCDate,
} from "@/utils/date.utils";

export class DashboardService {
  // Muscle group mappings for each fitness goal
  private static readonly muscleGroupMappings: MuscleGroupGoalMapping = {
    [FitnessGoals.WEIGHT_LOSS]: [
      "core",
      "legs",
      "full_body",
      "full body",
      "cardiovascular",
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
    [FitnessGoals.ENDURANCE]: [
      "cardiovascular",
      "legs",
      "core",
      "full_body",
      "full body",
      "cardio",
    ],
    [FitnessGoals.FLEXIBILITY]: [
      "full_body",
      "full body",
      "core",
      "back",
      "shoulders",
      "hips",
    ],
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
    [FitnessGoals.MOBILITY]: [
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

  async getDashboardMetrics(
    userId: number,
    startDate?: string,
    endDate?: string,
    groupBy?: "exercise" | "day" | "muscle_group"
  ): Promise<DashboardMetrics> {
    const [
      weeklySummary,
      workoutConsistency,
      weightMetrics,
      weightAccuracy,
      goalProgress,
      totalVolumeMetrics,
      dailyWorkoutProgress,
    ] = await Promise.all([
      this.getWeeklySummary(userId),
      this.getWorkoutConsistency(userId, startDate, endDate),
      this.getWeightMetrics(userId, startDate, endDate, groupBy),
      this.getWeightAccuracyMetrics(userId, startDate, endDate),
      this.getGoalProgress(userId, startDate, endDate),
      this.getTotalVolumeMetrics(userId, startDate, endDate),
      this.getDailyWorkoutProgress(userId),
    ]);

    return {
      weeklySummary,
      workoutConsistency,
      weightMetrics,
      weightAccuracy,
      goalProgress,
      totalVolumeMetrics,
      dailyWorkoutProgress,
    };
  }

  async getWeeklySummary(userId: number): Promise<WeeklySummary> {
    // First, get the currently active workout plan
    const activeWorkout = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)))
      .limit(1);

    if (!activeWorkout[0]) {
      return {
        workoutCompletionRate: 0,
        exerciseCompletionRate: 0,
        totalWorkoutsThisWeek: 0,
        completedWorkoutsThisWeek: 0,
        streak: 0,
      };
    }

    const workoutId = activeWorkout[0].id;

    // Calculate current week bounds (Monday to Sunday)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust for Sunday

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    // Get all planned days for the active workout in the current week
    const plannedDaysThisWeek = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
      })
      .from(planDays)
      .where(
        and(
          eq(planDays.workoutId, workoutId),
          gte(planDays.date, weekStartStr),
          lte(planDays.date, weekEndStr)
        )
      )
      .orderBy(asc(planDays.date));

    // Get all exercises planned for this week
    const allExercisesThisWeek = await db
      .select({
        planDayExerciseId: planDayExercises.id,
        planDayId: planDayExercises.planDayId,
        date: planDays.date,
      })
      .from(planDayExercises)
      .innerJoin(planDays, eq(planDayExercises.planDayId, planDays.id))
      .where(
        and(
          eq(planDays.workoutId, workoutId),
          gte(planDays.date, weekStartStr),
          lte(planDays.date, weekEndStr)
        )
      );

    // Get completed exercises for this week
    const completedExercisesThisWeek = await db
      .select({
        planDayExerciseId: exerciseLogs.planDayExerciseId,
        planDayId: planDayExercises.planDayId,
        date: planDays.date,
      })
      .from(exerciseLogs)
      .innerJoin(
        planDayExercises,
        eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
      )
      .innerJoin(planDays, eq(planDayExercises.planDayId, planDays.id))
      .where(
        and(
          eq(planDays.workoutId, workoutId),
          eq(exerciseLogs.isComplete, true),
          gte(planDays.date, weekStartStr),
          lte(planDays.date, weekEndStr)
        )
      );

    // Check which plan days have been completed by checking if exercises were logged (current week only)
    const planDayCompletionDataThisWeek = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        totalExercises: sql<number>`COUNT(${planDayExercises.id})`,
        completedExercises: sql<number>`COUNT(CASE WHEN ${exerciseLogs.isComplete} = true THEN 1 END)`,
        hasExerciseLogs: sql<boolean>`COUNT(${exerciseLogs.id}) > 0`,
      })
      .from(planDays)
      .leftJoin(planDayExercises, eq(planDays.id, planDayExercises.planDayId))
      .leftJoin(
        exerciseLogs,
        eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
      )
      .where(
        and(
          eq(planDays.workoutId, workoutId),
          gte(planDays.date, weekStartStr),
          lte(planDays.date, weekEndStr)
        )
      )
      .groupBy(planDays.id, planDays.date)
      .orderBy(asc(planDays.date));

    // Calculate completion rates
    const totalWorkoutsThisWeek = plannedDaysThisWeek.length;
    const completedWorkoutsThisWeek = planDayCompletionDataThisWeek.filter(
      (day) => day.hasExerciseLogs && day.completedExercises > 0
    ).length;

    const totalExercisesThisWeek = allExercisesThisWeek.length;
    const completedExercisesCount = completedExercisesThisWeek.length;

    const workoutCompletionRate =
      totalWorkoutsThisWeek > 0
        ? Math.round((completedWorkoutsThisWeek / totalWorkoutsThisWeek) * 100)
        : 0;

    const exerciseCompletionRate =
      totalExercisesThisWeek > 0
        ? Math.round((completedExercisesCount / totalExercisesThisWeek) * 100)
        : 0;

    // Calculate streak
    const streak = await this.calculateActiveWorkoutStreak(
      workoutId,
      planDayCompletionDataThisWeek.map((day) => ({
        planDayId: day.planDayId,
        date: day.date,
        hasExerciseLogs: day.hasExerciseLogs,
      }))
    );

    return {
      workoutCompletionRate,
      exerciseCompletionRate,
      totalWorkoutsThisWeek,
      completedWorkoutsThisWeek,
      streak,
    };
  }

  async getWorkoutConsistency(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<WorkoutConsistency[]> {
    // Get the currently active workout plan
    const activeWorkout = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)))
      .limit(1);

    if (!activeWorkout[0]) {
      return [];
    }

    const workoutId = activeWorkout[0].id;

    // Get all plan days for the active workout
    const allPlanDays = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
      })
      .from(planDays)
      .where(eq(planDays.workoutId, workoutId))
      .orderBy(asc(planDays.date));

    if (allPlanDays.length === 0) {
      return [];
    }

    // Check which plan days have been completed by checking if exercises were logged
    const planDayCompletionData = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        hasExerciseLogs: sql<boolean>`COUNT(${exerciseLogs.id}) > 0`,
      })
      .from(planDays)
      .leftJoin(planDayExercises, eq(planDays.id, planDayExercises.planDayId))
      .leftJoin(
        exerciseLogs,
        eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
      )
      .where(eq(planDays.workoutId, workoutId))
      .groupBy(planDays.id, planDays.date)
      .orderBy(asc(planDays.date));

    // Group plan days by weeks (7-day periods starting from the first plan day)
    const workoutStartDate = new Date(allPlanDays[0].date);
    const weeklyData: WorkoutConsistency[] = [];

    // Create a map for quick lookup of completion status
    const completionMap = new Map<string, boolean>();
    planDayCompletionData.forEach((day) => {
      completionMap.set(day.date, day.hasExerciseLogs);
    });

    // Group days into 7-day weeks
    let currentWeekStart = new Date(workoutStartDate);
    let weekIndex = 0;
    const today = new Date().toISOString().split("T")[0];

    while (weekIndex * 7 < allPlanDays.length) {
      const weekStartDate = new Date(currentWeekStart);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 6);

      // Get plan days for this week
      const weekPlanDays = allPlanDays.filter((day) => {
        const dayDate = new Date(day.date);
        return dayDate >= weekStartDate && dayDate <= weekEndDate;
      });

      // Count completed days in this week
      const completedDays = weekPlanDays.filter(
        (day) => completionMap.get(day.date) === true
      ).length;

      const completionRate =
        weekPlanDays.length > 0
          ? (completedDays / weekPlanDays.length) * 100
          : 0;

      // Determine status and progress
      const weekStartStr = weekStartDate.toISOString().split("T")[0];
      const weekEndStr = weekEndDate.toISOString().split("T")[0];

      let status: "completed" | "in-progress" | "upcoming";
      let isInProgress = false;

      // Check if there are any completed exercises in this week
      const hasCompletedExercises = weekPlanDays.some(
        (day) => completionMap.get(day.date) === true
      );

      // A week is "in-progress" if:
      // 1. Today falls within the week range, OR
      // 2. There are completed exercises in this week (user is actively working on it)
      if (
        (today >= weekStartStr && today <= weekEndStr) ||
        hasCompletedExercises
      ) {
        status = "in-progress";
        isInProgress = true;
      } else if (today > weekEndStr) {
        status = "completed";
      } else {
        status = "upcoming";
      }

      // Create readable week label
      const weekStartFormatted = weekStartDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const weekEndFormatted = weekEndDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const weekLabel = `Week ${
        weekIndex + 1
      } (${weekStartFormatted}-${weekEndFormatted})`;

      weeklyData.push({
        week: weekStartStr,
        weekLabel,
        totalWorkouts: weekPlanDays.length,
        completedWorkouts: completedDays,
        completionRate: Math.round(completionRate * 100) / 100,
        isInProgress,
        status,
      });

      // Move to next week
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
      weekIndex++;

      // Stop if we've covered all plan days
      if (weekIndex * 7 >= allPlanDays.length) {
        break;
      }
    }

    return weeklyData;
  }

  async getWeightMetrics(
    userId: number,
    startDate?: string,
    endDate?: string,
    groupBy?: "exercise" | "day" | "muscle_group"
  ): Promise<WeightMetrics[]> {
    const { start, end } = getDateRangeUTC(startDate, endDate);

    let selectFields;
    let groupByClause;

    switch (groupBy) {
      case "day":
        selectFields = {
          name: planDays.date,
          totalWeight: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted} * ${exerciseLogs.weightUsed}), 0)::INTEGER`,
          muscleGroups: sql<string[]>`ARRAY[]::text[]`,
        };
        groupByClause = [planDays.date];
        break;
      case "muscle_group":
        selectFields = {
          name: sql<string>`UNNEST(${exercises.muscleGroups})`,
          totalWeight: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted} * ${exerciseLogs.weightUsed}), 0)::INTEGER`,
          muscleGroups: sql<string[]>`ARRAY[UNNEST(${exercises.muscleGroups})]`,
        };
        groupByClause = [sql`UNNEST(${exercises.muscleGroups})`];
        break;
      default: // exercise (most useful default)
        selectFields = {
          name: exercises.name,
          totalWeight: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted} * ${exerciseLogs.weightUsed}), 0)::INTEGER`,
          muscleGroups: exercises.muscleGroups,
        };
        groupByClause = [exercises.id, exercises.name, exercises.muscleGroups];
    }

    const weightData = await db
      .select(selectFields)
      .from(exerciseLogs)
      .innerJoin(
        planDayExercises,
        eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
      )
      .innerJoin(planDays, eq(planDayExercises.planDayId, planDays.id))
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workouts.userId, userId),
          sql`${exerciseLogs.weightUsed} > 0`,
          gte(exerciseLogs.createdAt, start),
          lte(exerciseLogs.createdAt, end)
        )
      )
      .groupBy(...groupByClause)
      .orderBy(
        desc(
          sql`SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted} * ${exerciseLogs.weightUsed})`
        )
      )
      .limit(20);

    return weightData.map((data) => ({
      name: data.name,
      totalWeight: data.totalWeight || 0,
      muscleGroups: data.muscleGroups || [],
    }));
  }

  async getWeightAccuracyMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<WeightAccuracyMetrics> {
    const { start, end } = getDateRangeUTC(startDate, endDate);

    // Get all exercise logs with their planned weights
    const allExerciseData = await db
      .select({
        exerciseLogId: exerciseLogs.id,
        weightUsed: exerciseLogs.weightUsed,
        plannedWeight: planDayExercises.weight,
        exerciseName: exercises.name,
        setsCompleted: exerciseLogs.setsCompleted,
        repsCompleted: exerciseLogs.repsCompleted,
      })
      .from(exerciseLogs)
      .innerJoin(
        planDayExercises,
        eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
      )
      .innerJoin(planDays, eq(planDayExercises.planDayId, planDays.id))
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workouts.userId, userId),
          eq(workouts.isActive, true),
          sql`${exerciseLogs.setsCompleted} > 0`,
          sql`${exerciseLogs.repsCompleted} > 0`,
          gte(exerciseLogs.createdAt, start),
          lte(exerciseLogs.createdAt, end)
        )
      );

    if (allExerciseData.length === 0) {
      return {
        accuracyRate: 0,
        totalSets: 0,
        exactMatches: 0,
        higherWeight: 0,
        lowerWeight: 0,
        avgWeightDifference: 0,
        chartData: [],
        hasPlannedWeights: false,
        hasExerciseData: false,
      };
    }

    // Separate into different categories
    const plannedWeightExercises = allExerciseData.filter(
      (e) => (e.plannedWeight || 0) > 0
    );
    const bodyweightWithAddedWeight = allExerciseData.filter(
      (e) => (e.plannedWeight || 0) === 0 && (e.weightUsed || 0) > 0
    );
    const pureBodyweight = allExerciseData.filter(
      (e) => (e.plannedWeight || 0) === 0 && (e.weightUsed || 0) === 0
    );

    let totalSets = 0;
    let exactMatches = 0;
    let higherWeight = 0;
    let lowerWeight = 0;
    let weightDifferences: number[] = [];

    // Process exercises with planned weights
    plannedWeightExercises.forEach((exercise) => {
      totalSets++;
      const plannedWeight = exercise.plannedWeight || 0;
      const weightUsed = exercise.weightUsed || 0;
      const diff = weightUsed - plannedWeight;
      weightDifferences.push(diff);

      if (weightUsed === plannedWeight) {
        exactMatches++;
      } else if (weightUsed > plannedWeight) {
        higherWeight++;
      } else {
        lowerWeight++;
      }
    });

    // Process bodyweight exercises where user added weight
    bodyweightWithAddedWeight.forEach((exercise) => {
      totalSets++;
      higherWeight++; // Adding weight to bodyweight exercise counts as "higher"
      weightDifferences.push(exercise.weightUsed || 0); // Difference from 0
    });

    const accuracyRate = totalSets > 0 ? (exactMatches / totalSets) * 100 : 0;
    const avgWeightDifference =
      weightDifferences.length > 0
        ? weightDifferences.reduce((sum, diff) => sum + diff, 0) /
          weightDifferences.length
        : 0;

    // Create chart data
    const chartData = [];

    if (exactMatches > 0) {
      chartData.push({
        label: "✅ As Planned",
        value: Math.round((exactMatches / totalSets) * 100 * 100) / 100,
        color: "#10b981",
        count: exactMatches,
      });
    }

    if (higherWeight > 0) {
      chartData.push({
        label: "💪 Progressed",
        value: Math.round((higherWeight / totalSets) * 100 * 100) / 100,
        color: "#f59e0b",
        count: higherWeight,
      });
    }

    if (lowerWeight > 0) {
      chartData.push({
        label: "⚡ Adapted",
        value: Math.round((lowerWeight / totalSets) * 100 * 100) / 100,
        color: "#ef4444",
        count: lowerWeight,
      });
    }

    return {
      accuracyRate: Math.round(accuracyRate * 100) / 100,
      totalSets,
      exactMatches,
      higherWeight,
      lowerWeight,
      avgWeightDifference: Math.round(avgWeightDifference * 100) / 100,
      chartData,
      hasPlannedWeights:
        plannedWeightExercises.length > 0 ||
        bodyweightWithAddedWeight.length > 0,
      hasExerciseData: allExerciseData.length > 0,
    };
  }

  async getGoalProgress(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<GoalProgress[]> {
    const userProfile = await db
      .select({ goals: profiles.goals })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    if (!userProfile[0] || !userProfile[0].goals) {
      return [];
    }

    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Extend end date to include the full day
    end.setHours(23, 59, 59, 999);

    const goalProgress = await Promise.all(
      userProfile[0].goals
        .filter((goal) => goal !== (FitnessGoals.WEIGHT_LOSS as any))
        .map(async (goal) => {
          const relevantMuscleGroups =
            DashboardService.muscleGroupMappings[goal];

          let muscleGroupFilter;
          if (goal === "muscle_gain") {
            muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'quadriceps', 'glutes', 'hamstrings']::text[]`;
          } else if (goal === "strength") {
            muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['chest', 'back', 'legs', 'core', 'shoulders', 'quadriceps', 'glutes', 'hamstrings', 'biceps', 'triceps']::text[]`;
          } else if (goal === "endurance") {
            muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['cardiovascular', 'legs', 'core', 'full_body', 'full body', 'cardio']::text[]`;
          } else if (goal === "general_fitness") {
            muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['full_body', 'full body', 'cardiovascular', 'core', 'legs', 'chest', 'back', 'shoulders']::text[]`;
          } else if (goal === "flexibility") {
            muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['full_body', 'full body', 'core', 'back', 'shoulders', 'hips']::text[]`;
          } else {
            muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['full_body', 'full body', 'core']::text[]`;
          }

          const exerciseData = await db
            .select({
              totalSets: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted}), 0)::INTEGER`,
              totalReps: sql<number>`COALESCE(SUM(${exerciseLogs.repsCompleted}), 0)::INTEGER`,
              totalWeight: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted} * ${exerciseLogs.weightUsed}), 0)::INTEGER`,
              completedWorkouts: sql<number>`COUNT(DISTINCT ${planDays.id})::INTEGER`,
            })
            .from(exerciseLogs)
            .innerJoin(
              planDayExercises,
              eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
            )
            .innerJoin(planDays, eq(planDayExercises.planDayId, planDays.id))
            .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
            .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
            .where(
              and(
                eq(workouts.userId, userId),
                eq(workouts.isActive, true), // Only include active workouts
                gte(exerciseLogs.createdAt, start),
                lte(exerciseLogs.createdAt, end),
                eq(exerciseLogs.isComplete, true),
                muscleGroupFilter
              )
            );

          const data = exerciseData[0];

          let progressScore = 0;
          if (
            goal === FitnessGoals.WEIGHT_LOSS ||
            goal === FitnessGoals.ENDURANCE
          ) {
            progressScore = Math.min((data.completedWorkouts || 0) * 10, 100);
          } else if (
            goal === FitnessGoals.STRENGTH ||
            goal === FitnessGoals.MUSCLE_GAIN
          ) {
            progressScore = Math.min(
              ((data.totalWeight || 0) / 1000) * 10,
              100
            );
          } else {
            progressScore = Math.min((data.completedWorkouts || 0) * 15, 100);
          }

          return {
            goal,
            progressScore: Math.round(progressScore),
            totalSets: data.totalSets || 0,
            totalReps: data.totalReps || 0,
            totalWeight: data.totalWeight || 0,
            completedWorkouts: data.completedWorkouts || 0,
          };
        })
    );

    return goalProgress;
  }

  async getTotalVolumeMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<TotalVolumeMetrics[]> {
    const { start, end } = getDateRangeUTC(startDate, endDate);

    // Get daily data for weighted exercises only (makes more sense for strength progress)
    const weightedExerciseData = await db
      .select({
        date: sql<string>`DATE(${exerciseLogs.createdAt})`,
        totalWeight: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted} * ${exerciseLogs.weightUsed}), 0)::INTEGER`,
        exerciseCount: sql<number>`COUNT(DISTINCT ${exercises.id})::INTEGER`,
        totalSets: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted}), 0)::INTEGER`,
        totalReps: sql<number>`COALESCE(SUM(${exerciseLogs.repsCompleted}), 0)::INTEGER`,
        avgWeight: sql<number>`COALESCE(AVG(${exerciseLogs.weightUsed}), 0)::NUMERIC(10,2)`,
      })
      .from(exerciseLogs)
      .innerJoin(
        planDayExercises,
        eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
      )
      .innerJoin(planDays, eq(planDayExercises.planDayId, planDays.id))
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workouts.userId, userId),
          eq(workouts.isActive, true),
          sql`${exerciseLogs.weightUsed} > 0`, // Only weighted exercises for strength progress
          sql`${exerciseLogs.setsCompleted} > 0`,
          sql`${exerciseLogs.repsCompleted} > 0`,
          gte(exerciseLogs.createdAt, start),
          lte(exerciseLogs.createdAt, end)
        )
      )
      .groupBy(sql`DATE(${exerciseLogs.createdAt})`)
      .orderBy(asc(sql`DATE(${exerciseLogs.createdAt})`));

    // If no weighted exercises, get bodyweight exercise data
    if (weightedExerciseData.length === 0) {
      const bodyweightData = await db
        .select({
          date: sql<string>`DATE(${exerciseLogs.createdAt})`,
          totalVolume: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted}), 0)::INTEGER`,
          exerciseCount: sql<number>`COUNT(DISTINCT ${exercises.id})::INTEGER`,
          totalSets: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted}), 0)::INTEGER`,
          totalReps: sql<number>`COALESCE(SUM(${exerciseLogs.repsCompleted}), 0)::INTEGER`,
        })
        .from(exerciseLogs)
        .innerJoin(
          planDayExercises,
          eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
        )
        .innerJoin(planDays, eq(planDayExercises.planDayId, planDays.id))
        .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
        .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
        .where(
          and(
            eq(workouts.userId, userId),
            eq(workouts.isActive, true),
            sql`${exerciseLogs.setsCompleted} > 0`,
            sql`${exerciseLogs.repsCompleted} > 0`,
            gte(exerciseLogs.createdAt, start),
            lte(exerciseLogs.createdAt, end)
          )
        )
        .groupBy(sql`DATE(${exerciseLogs.createdAt})`)
        .orderBy(asc(sql`DATE(${exerciseLogs.createdAt})`));

      return bodyweightData.map((data) => {
        const date = new Date(data.date);
        const label = formatDateForDisplay(date, {
          month: "short",
          day: "numeric",
        });

        return {
          date: data.date,
          totalVolume: data.totalVolume || 0,
          exerciseCount: data.exerciseCount || 0,
          label,
        };
      });
    }

    return weightedExerciseData.map((data) => {
      const date = new Date(data.date);
      const label = formatDateForDisplay(date, {
        month: "short",
        day: "numeric",
      });

      return {
        date: data.date,
        totalVolume: data.totalWeight || 0,
        exerciseCount: data.exerciseCount || 0,
        label,
      };
    });
  }

  private async calculateWorkoutStreak(userId: number): Promise<number> {
    const recentWorkouts = await db
      .select({
        date: planDays.date,
        completed: sql<boolean>`COALESCE(${workoutLogs.isComplete}, false)`,
      })
      .from(planDays)
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .leftJoin(workoutLogs, eq(workouts.id, workoutLogs.workoutId))
      .where(eq(workouts.userId, userId))
      .orderBy(desc(planDays.date))
      .limit(30);

    let streak = 0;
    const today = new Date().toISOString().split("T")[0];
    let currentDate = today;

    for (const workout of recentWorkouts) {
      if (workout.date === currentDate && workout.completed) {
        streak++;
        const prevDate = new Date(currentDate);
        prevDate.setDate(prevDate.getDate() - 1);
        currentDate = prevDate.toISOString().split("T")[0];
      } else if (workout.date === currentDate && !workout.completed) {
        break;
      }
    }

    return streak;
  }

  private async calculateActiveWorkoutStreak(
    workoutId: number,
    planDayCompletionData: {
      planDayId: number;
      date: string;
      hasExerciseLogs: boolean;
    }[]
  ): Promise<number> {
    // Sort by date (most recent first)
    const sortedDays = planDayCompletionData.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    let streak = 0;

    // Start from the most recent completed day and count consecutive completions backwards
    let foundFirstCompleted = false;

    for (const day of sortedDays) {
      if (day.hasExerciseLogs) {
        if (!foundFirstCompleted) {
          foundFirstCompleted = true;
        }
        streak++;
      } else if (foundFirstCompleted) {
        // Found an incomplete day after starting the streak count, break
        break;
      }
      // If we haven't found the first completed day yet, keep looking
    }

    return streak;
  }

  async getDailyWorkoutProgress(
    userId: number
  ): Promise<
    { date: string; completionRate: number; hasPlannedWorkout: boolean }[]
  > {
    // Get the currently active workout plan
    const activeWorkout = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)))
      .limit(1);

    if (!activeWorkout[0]) {
      return [];
    }

    const workoutId = activeWorkout[0].id;
    const workoutStartStr = activeWorkout[0].startDate;

    // Extract date part and create 7 consecutive dates starting from workout start
    const startDateOnly = workoutStartStr.split("T")[0];

    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDateOnly);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split("T")[0]);
    }

    // Get all plan days for this workout
    const allPlanDays = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
      })
      .from(planDays)
      .where(eq(planDays.workoutId, workoutId))
      .orderBy(asc(planDays.date));

    // Get completion data for all plan days
    const planDayCompletionData = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        totalExercises: sql<number>`COUNT(${planDayExercises.id})`,
        completedExercises: sql<number>`COUNT(CASE WHEN ${exerciseLogs.isComplete} = true THEN 1 END)`,
      })
      .from(planDays)
      .leftJoin(planDayExercises, eq(planDays.id, planDayExercises.planDayId))
      .leftJoin(
        exerciseLogs,
        eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
      )
      .where(eq(planDays.workoutId, workoutId))
      .groupBy(planDays.id, planDays.date)
      .orderBy(asc(planDays.date));

    // Create daily progress for our 7-day period
    const dailyProgress = dates.map((dateStr) => {
      const planDay = allPlanDays.find((day) => day.date === dateStr);
      const hasPlannedWorkout = !!planDay;

      const completionData = planDayCompletionData.find(
        (day) => day.date === dateStr
      );
      let completionRate = 0;

      if (completionData && completionData.totalExercises > 0) {
        completionRate = Math.round(
          (completionData.completedExercises / completionData.totalExercises) *
            100
        );
      }

      return {
        date: dateStr,
        completionRate,
        hasPlannedWorkout,
      };
    });

    return dailyProgress;
  }
}

export const dashboardService = new DashboardService();

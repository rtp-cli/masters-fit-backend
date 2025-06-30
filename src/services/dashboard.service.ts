import { db } from "@/config/database";
import {
  workouts,
  planDays,
  planDayExercises,
  workoutBlocks,
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
  WorkoutTypeMetrics,
  WorkoutTypeDistribution,
} from "@/types/dashboard/types";
import { BaseService } from "@/services/base.service";
import {
  getDateRangeUTC,
  formatDateForDisplay,
  getCurrentUTCDate,
} from "@/utils/date.utils";
import { logger } from "@/utils/logger";

export class DashboardService {
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

  // Color mapping for workout types
  private static readonly workoutTypeColors: Record<string, string> = {
    strength: "#E53E3E", // Vibrant Red
    cardio: "#3182CE", // Rich Blue
    flexibility: "#38A169", // Forest Green
    mobility: "#805AD5", // Royal Purple
    balance: "#D69E2E", // Golden Yellow
    endurance: "#319795", // Teal
    power: "#E53E3E", // Vibrant Red (same as strength for consistency)
    recovery: "#718096", // Soft Gray
    functional: "#48BB78", // Fresh Green
    core: "#ED8936", // Warm Orange
    plyometric: "#00B5D8", // Bright Cyan
    hiit: "#F56565", // Coral Red
    yoga: "#9F7AEA", // Soft Purple
    pilates: "#4FD1C7", // Mint Green
    crossfit: "#F687B3", // Pink
    rehabilitation: "#4299E1", // Sky Blue
    stretching: "#68D391", // Light Green
    warmup: "#F6E05E", // Sunny Yellow
    cooldown: "#63B3ED", // Light Blue
    compound: "#B794F6", // Lavender
    isolation: "#FC8181", // Light Coral
    bodyweight: "#81C784", // Sage Green
    default: "#A0AEC0", // Neutral Gray
  };

  // Label mapping for workout types
  private static readonly workoutTypeLabels: Record<string, string> = {
    strength: "Strength",
    cardio: "Cardio",
    flexibility: "Flexibility",
    mobility: "Mobility",
    balance: "Balance",
    endurance: "Endurance",
    power: "Power",
    recovery: "Recovery",
    functional: "Functional",
    core: "Core",
    plyometric: "Plyometric",
    hiit: "HIIT",
    yoga: "Yoga",
    pilates: "Pilates",
    crossfit: "CrossFit",
    rehabilitation: "Rehab",
    rehab: "Rehab",
    stretching: "Stretching",
    warmup: "Warm-up",
    cooldown: "Cool-down",
    compound: "Compound",
    isolation: "Isolation",
    bodyweight: "Bodyweight",
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
      workoutTypeMetrics,
      dailyWorkoutProgress,
    ] = await Promise.all([
      this.getWeeklySummary(userId),
      this.getWorkoutConsistency(userId, startDate, endDate),
      this.getWeightMetrics(userId, startDate, endDate, groupBy),
      this.getWeightAccuracyMetrics(userId, startDate, endDate),
      this.getGoalProgress(userId, startDate, endDate),
      this.getTotalVolumeMetrics(userId, startDate, endDate),
      this.getWorkoutTypeMetrics(userId, startDate, endDate).catch(
        (error: any) => {
          logger.error("Error fetching workout type metrics", error as Error, {
            userId,
            operation: "getWorkoutTypeMetrics",
          });
          return {
            distribution: [],
            totalExercises: 0,
            totalSets: 0,
            dominantType: "",
            hasData: false,
          };
        }
      ),
      this.getDailyWorkoutProgress(userId),
    ]);

    return {
      weeklySummary,
      workoutConsistency,
      weightMetrics,
      weightAccuracy,
      goalProgress,
      totalVolumeMetrics,
      workoutTypeMetrics,
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

    // Get the actual workout date range instead of forcing current week
    const workoutDateRange = await db
      .select({
        minDate: sql<string>`MIN(${planDays.date})`,
        maxDate: sql<string>`MAX(${planDays.date})`,
      })
      .from(planDays)
      .where(eq(planDays.workoutId, workoutId));

    const dateRange = workoutDateRange[0];
    if (!dateRange?.minDate || !dateRange?.maxDate) {
      return {
        workoutCompletionRate: 0,
        exerciseCompletionRate: 0,
        totalWorkoutsThisWeek: 0,
        completedWorkoutsThisWeek: 0,
        streak: 0,
      };
    }

    // Use the actual workout week instead of calendar week
    // Get the first week of the workout plan
    const workoutStartDate = new Date(dateRange.minDate);
    const weekStart = new Date(workoutStartDate);
    const weekEnd = new Date(workoutStartDate);
    weekEnd.setDate(weekStart.getDate() + 6); // 7-day week

    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    // Get all planned days for the active workout in the first workout week
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
        planDayId: workoutBlocks.planDayId,
        date: planDays.date,
      })
      .from(planDayExercises)
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
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
        planDayId: workoutBlocks.planDayId,
        date: planDays.date,
      })
      .from(exerciseLogs)
      .innerJoin(
        planDayExercises,
        eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
      )
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
      .where(
        and(
          eq(planDays.workoutId, workoutId),
          gte(planDays.date, weekStartStr),
          lte(planDays.date, weekEndStr)
        )
      );

    // Check which plan days have been completed by checking if exercises were logged (first week only)
    const planDayCompletionDataThisWeek = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        totalExercises: sql<number>`COUNT(${planDayExercises.id})`,
        completedExercises: sql<number>`COUNT(CASE WHEN ${exerciseLogs.id} IS NOT NULL THEN 1 END)`,
        hasExerciseLogs: sql<boolean>`COUNT(${exerciseLogs.id}) > 0`,
      })
      .from(planDays)
      .leftJoin(workoutBlocks, eq(planDays.id, workoutBlocks.planDayId))
      .leftJoin(
        planDayExercises,
        eq(workoutBlocks.id, planDayExercises.workoutBlockId)
      )
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
    const totalWorkoutsThisWeek = planDayCompletionDataThisWeek.length;
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

    // Calculate streak - get ALL plan day completion data across ALL workout plans, not just active one
    const allPlanDayCompletionData = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        workoutId: planDays.workoutId,
        totalExercises: sql<number>`COUNT(${planDayExercises.id})`,
        completedExercises: sql<number>`COUNT(CASE WHEN ${exerciseLogs.id} IS NOT NULL THEN 1 END)`,
        hasExerciseLogs: sql<boolean>`COUNT(${exerciseLogs.id}) > 0`,
      })
      .from(planDays)
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .leftJoin(workoutBlocks, eq(planDays.id, workoutBlocks.planDayId))
      .leftJoin(
        planDayExercises,
        eq(workoutBlocks.id, planDayExercises.workoutBlockId)
      )
      .leftJoin(
        exerciseLogs,
        eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
      )
      .where(eq(workouts.userId, userId)) // Get all workouts for user, not just active
      .groupBy(planDays.id, planDays.date, planDays.workoutId)
      .orderBy(asc(planDays.date));

    const streak = await this.calculateGlobalWorkoutStreak(
      allPlanDayCompletionData.map((day) => ({
        planDayId: day.planDayId,
        date: day.date,
        workoutId: day.workoutId,
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
      .leftJoin(workoutBlocks, eq(planDays.id, workoutBlocks.planDayId))
      .leftJoin(
        planDayExercises,
        eq(workoutBlocks.id, planDayExercises.workoutBlockId)
      )
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
    // Build basic conditions
    const whereConditions = [
      eq(workouts.userId, userId),
      sql`${exerciseLogs.weightUsed} > 0`,
    ];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);
      whereConditions.push(gte(exerciseLogs.createdAt, start));
      whereConditions.push(lte(exerciseLogs.createdAt, end));
    }

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
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
      .where(and(...whereConditions))
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
    // Build basic conditions
    const whereConditions = [
      eq(workouts.userId, userId),
      sql`${exerciseLogs.setsCompleted} > 0`,
      sql`${exerciseLogs.repsCompleted} > 0`,
    ];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);

      // Filter by plan day date to get workouts planned within the date range
      const startDateStr = start.toISOString().split("T")[0];
      const endDateStr = end.toISOString().split("T")[0];

      if (startDate) {
        whereConditions.push(gte(planDays.date, startDateStr));
      }
      if (endDate) {
        whereConditions.push(lte(planDays.date, endDateStr));
      }
    }

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
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
      .where(and(...whereConditions));

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
      (e) => (e.plannedWeight || 0) === 0 && (Number(e.weightUsed) || 0) > 0
    );
    const pureBodyweight = allExerciseData.filter(
      (e) => (e.plannedWeight || 0) === 0 && (Number(e.weightUsed) || 0) === 0
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
      const weightUsed = Number(exercise.weightUsed) || 0;
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
      weightDifferences.push(Number(exercise.weightUsed) || 0); // Difference from 0
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
        label: "As Planned",
        value: Math.round((exactMatches / totalSets) * 100 * 100) / 100,
        color: "#10b981",
        count: exactMatches,
      });
    }

    if (higherWeight > 0) {
      chartData.push({
        label: "Progressed",
        value: Math.round((higherWeight / totalSets) * 100 * 100) / 100,
        color: "#f59e0b",
        count: higherWeight,
      });
    }

    if (lowerWeight > 0) {
      chartData.push({
        label: "Adapted",
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

    if (
      !userProfile[0] ||
      !userProfile[0].goals ||
      !Array.isArray(userProfile[0].goals)
    ) {
      return [];
    }

    // Get active workout plan to understand the timeline
    const activeWorkout = await db
      .select({
        id: workouts.id,
        startDate: workouts.startDate,
        endDate: workouts.endDate,
        name: workouts.name,
      })
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.isActive, true)))
      .limit(1);

    if (!activeWorkout[0]) {
      return [];
    }

    const workoutPlan = activeWorkout[0];
    const planStartDate = new Date(workoutPlan.startDate);
    const planEndDate = workoutPlan.endDate
      ? new Date(workoutPlan.endDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days if no end date
    const today = new Date();

    // Calculate plan progress (how far into the plan we are)
    const totalPlanDays = Math.ceil(
      (planEndDate.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysCompleted = Math.max(
      0,
      Math.ceil(
        (today.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24)
      )
    );
    const planProgressRatio = Math.min(daysCompleted / totalPlanDays, 1.0);

    // Get total planned workouts in the plan
    const totalPlannedWorkouts = await db
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(planDays)
      .where(eq(planDays.workoutId, workoutPlan.id));

    const plannedWorkoutCount = totalPlannedWorkouts[0]?.count || 1;

    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : planStartDate;

    // Extend end date to include the full day
    end.setHours(23, 59, 59, 999);

    const goalProgress = await Promise.all(
      userProfile[0].goals.map(async (goal) => {
        const relevantMuscleGroups = DashboardService.muscleGroupMappings[goal];

        let muscleGroupFilter;
        if (goal === "muscle_gain") {
          muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'quadriceps', 'glutes', 'hamstrings']::text[]`;
        } else if (goal === "strength") {
          muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['chest', 'back', 'legs', 'core', 'shoulders', 'quadriceps', 'glutes', 'hamstrings', 'biceps', 'triceps']::text[]`;
        } else if (goal === "endurance") {
          muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['cardiovascular', 'legs', 'core', 'full_body', 'full body', 'cardio']::text[]`;
        } else if (goal === "general_fitness") {
          muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['full_body', 'full body', 'cardiovascular', 'core', 'legs', 'chest', 'back', 'shoulders']::text[]`;
        } else if (goal === "fat_loss") {
          muscleGroupFilter = sql`${exercises.muscleGroups} && ARRAY['core', 'legs', 'full_body', 'full body', 'cardiovascular', 'cardio']::text[]`;
        } else if (goal === "mobility_flexibility") {
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
            avgWeightPerSet: sql<number>`CASE WHEN COUNT(*) > 0 THEN COALESCE(AVG(${exerciseLogs.weightUsed}), 0) ELSE 0 END::NUMERIC(10,2)`,
            uniqueExercisesDone: sql<number>`COUNT(DISTINCT ${exercises.id})::INTEGER`,
          })
          .from(exerciseLogs)
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
              eq(workouts.userId, userId),
              eq(workouts.isActive, true),
              gte(exerciseLogs.createdAt, start),
              lte(exerciseLogs.createdAt, end),
              eq(exerciseLogs.isComplete, true),
              muscleGroupFilter
            )
          );

        const data = exerciseData[0];

        // Calculate progress score based on multiple factors
        let progressScore = 0;
        const completedWorkouts = data.completedWorkouts || 0;
        const workoutCompletionRatio = Math.min(
          completedWorkouts / plannedWorkoutCount,
          1.0
        );

        if (goal === FitnessGoals.FAT_LOSS || goal === FitnessGoals.ENDURANCE) {
          // For weight loss/endurance: Focus on consistency and workout completion
          const consistencyScore = workoutCompletionRatio * 70; // 70% for workout completion
          const volumeScore =
            Math.min((data.totalReps || 0) / (plannedWorkoutCount * 50), 1.0) *
            30; // 30% for volume (target ~50 reps per workout)
          progressScore = consistencyScore + volumeScore;
        } else if (
          goal === FitnessGoals.STRENGTH ||
          goal === FitnessGoals.MUSCLE_GAIN
        ) {
          // For strength/muscle gain: Balance between consistency, volume, and progressive overload
          const consistencyScore = workoutCompletionRatio * 50; // 50% for workout completion
          const volumeScore =
            Math.min(
              (data.totalWeight || 0) / (plannedWorkoutCount * 2000),
              1.0
            ) * 30; // 30% for volume (target ~2000 lbs per workout)
          const intensityScore =
            Math.min((data.avgWeightPerSet || 0) / 50, 1.0) * 20; // 20% for intensity (target ~50 lbs average per set)
          progressScore = consistencyScore + volumeScore + intensityScore;
        } else if (goal === FitnessGoals.GENERAL_FITNESS) {
          // For general fitness: Balance of consistency and variety
          const consistencyScore = workoutCompletionRatio * 60; // 60% for workout completion
          const varietyScore =
            Math.min((data.uniqueExercisesDone || 0) / 10, 1.0) * 25; // 25% for exercise variety (target 10+ unique exercises)
          const volumeScore =
            Math.min((data.totalSets || 0) / (plannedWorkoutCount * 12), 1.0) *
            15; // 15% for volume (target ~12 sets per workout)
          progressScore = consistencyScore + varietyScore + volumeScore;
        } else {
          // For flexibility, mobility, balance, recovery: Focus on consistency and frequency
          const consistencyScore = workoutCompletionRatio * 80; // 80% for workout completion
          const frequencyScore =
            Math.min((data.totalSets || 0) / (plannedWorkoutCount * 8), 1.0) *
            20; // 20% for frequency (target ~8 sets per workout)
          progressScore = consistencyScore + frequencyScore;
        }

        // Apply time-based adjustment - don't penalize early in the plan
        const timeAdjustment = Math.max(0.3, planProgressRatio); // Minimum 30% adjustment factor
        progressScore = progressScore * timeAdjustment;

        // Cap at 100% and ensure minimum progress if user has done anything
        progressScore = Math.min(
          Math.max(progressScore, completedWorkouts > 0 ? 5 : 0),
          100
        );

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

  async getWorkoutTypeMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<WorkoutTypeMetrics> {
    // Only apply date filtering if dates are provided
    const whereConditions = [
      eq(workouts.userId, userId),
      sql`${exerciseLogs.setsCompleted} > 0`,
      sql`${exerciseLogs.repsCompleted} > 0`,
    ];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);

      // Filter by plan day date to get workouts planned within the date range
      const startDateStr = start.toISOString().split("T")[0];
      const endDateStr = end.toISOString().split("T")[0];

      if (startDate) {
        whereConditions.push(gte(planDays.date, startDateStr));
      }
      if (endDate) {
        whereConditions.push(lte(planDays.date, endDateStr));
      }
    }

    const workoutTypeData = await db
      .select({
        tag: exercises.tag,
        totalSets: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted}), 0)::INTEGER`,
        totalReps: sql<number>`COALESCE(SUM(${exerciseLogs.repsCompleted}), 0)::INTEGER`,
        exerciseCount: sql<number>`COUNT(DISTINCT ${exercises.id})::INTEGER`,
        completedWorkouts: sql<number>`COUNT(DISTINCT ${workouts.id})::INTEGER`,
      })
      .from(exerciseLogs)
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
      .where(and(...whereConditions))
      .groupBy(exercises.tag)
      .orderBy(desc(sql`SUM(${exerciseLogs.setsCompleted})`));

    const totalSets = workoutTypeData.reduce(
      (sum, item) => sum + item.totalSets,
      0
    );
    const totalExercises = workoutTypeData.reduce(
      (sum, item) => sum + item.exerciseCount,
      0
    );

    const distribution: WorkoutTypeDistribution[] = workoutTypeData
      .filter((item) => item.tag !== null)
      .map((item) => ({
        tag: item.tag!,
        label: DashboardService.workoutTypeLabels[item.tag!] || item.tag!,
        totalSets: item.totalSets,
        totalReps: item.totalReps,
        exerciseCount: item.exerciseCount,
        completedWorkouts: item.completedWorkouts,
        percentage:
          totalSets > 0
            ? Math.round((item.totalSets / totalSets) * 100 * 10) / 10
            : 0,
        color: DashboardService.workoutTypeColors[item.tag!] || "#6b7280",
      }));

    const dominantType =
      distribution.length > 0 ? distribution[0].label : "None";
    const hasData = distribution.length > 0 && totalSets > 0;

    return {
      distribution,
      totalExercises,
      totalSets,
      dominantType,
      hasData,
    };
  }

  async getTotalVolumeMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<TotalVolumeMetrics[]> {
    const { start: startDateUTC, end: endDateUTC } = getDateRangeUTC(
      startDate,
      endDate
    );

    // Get all exercise logs for the user within the date range
    const exerciseLogsQuery = db
      .select({
        logId: exerciseLogs.id,
        setsCompleted: exerciseLogs.setsCompleted,
        repsCompleted: exerciseLogs.repsCompleted,
        roundsCompleted: exerciseLogs.roundsCompleted,
        weightUsed: exerciseLogs.weightUsed,
        durationCompleted: exerciseLogs.durationCompleted,
        createdAt: exerciseLogs.createdAt,
        exerciseId: planDayExercises.exerciseId,
        exerciseName: exercises.name,
        muscleGroups: exercises.muscleGroups,
        planDayDate: planDays.date,
      })
      .from(exerciseLogs)
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
          eq(workouts.userId, userId),
          gte(exerciseLogs.createdAt, startDateUTC),
          lte(exerciseLogs.createdAt, endDateUTC),
          eq(exerciseLogs.isComplete, true)
        )
      )
      .orderBy(asc(exerciseLogs.createdAt));

    const exerciseLogsData = await exerciseLogsQuery;

    // Group by date and calculate volume
    const dailyVolumeMap = new Map<string, number>();
    const dailyExerciseCountMap = new Map<string, Set<number>>();

    exerciseLogsData.forEach((log) => {
      const dateStr = formatDateForDisplay(log.planDayDate);
      let volume = 0;

      // Calculate volume based on exercise type
      if (log.setsCompleted && log.repsCompleted && log.weightUsed) {
        // Traditional volume: sets × reps × weight
        volume =
          log.setsCompleted * log.repsCompleted * parseFloat(log.weightUsed);

        // If rounds are specified, multiply by rounds
        if (log.roundsCompleted && log.roundsCompleted > 0) {
          volume *= log.roundsCompleted;
        }
      } else if (log.repsCompleted) {
        // Bodyweight volume: just reps (or reps × rounds)
        volume = log.repsCompleted;

        if (log.roundsCompleted && log.roundsCompleted > 0) {
          volume *= log.roundsCompleted;
        }
      } else if (log.durationCompleted) {
        // Time-based volume: duration in seconds
        volume = log.durationCompleted;

        if (log.roundsCompleted && log.roundsCompleted > 0) {
          volume *= log.roundsCompleted;
        }
      }

      const currentVolume = dailyVolumeMap.get(dateStr) || 0;
      dailyVolumeMap.set(dateStr, currentVolume + volume);

      // Track unique exercises per day
      if (!dailyExerciseCountMap.has(dateStr)) {
        dailyExerciseCountMap.set(dateStr, new Set());
      }
      dailyExerciseCountMap.get(dateStr)!.add(log.exerciseId);
    });

    // Convert to array and sort by date
    const result: TotalVolumeMetrics[] = Array.from(dailyVolumeMap.entries())
      .map(([date, totalVolume]) => ({
        date,
        totalVolume,
        exerciseCount: dailyExerciseCountMap.get(date)?.size || 0,
        label: formatDateForDisplay(date),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return result;
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
    if (planDayCompletionData.length === 0) {
      return 0;
    }

    // Sort plan days by date (oldest to newest)
    const sortedDays = planDayCompletionData.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Find the longest streak of following the plan (completing workouts + rest days)
    // A streak continues as long as planned workouts are completed
    // Rest days (gaps between planned workout days) don't break the streak

    let longestStreak = 0;
    let currentStreak = 0;

    // Go through each planned workout day
    for (let i = 0; i < sortedDays.length; i++) {
      const day = sortedDays[i];

      if (day.hasExerciseLogs) {
        // Workout completed - extend current streak
        currentStreak++;

        // Add any rest days between this workout and the previous one
        if (i > 0) {
          const prevDay = new Date(sortedDays[i - 1].date);
          const thisDay = new Date(day.date);
          const daysBetween =
            Math.floor(
              (thisDay.getTime() - prevDay.getTime()) / (1000 * 60 * 60 * 24)
            ) - 1;
          currentStreak += daysBetween; // Add rest days to streak
        }

        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        // Planned workout was missed - reset current streak
        currentStreak = 0;
      }
    }

    // If the last planned workout was completed, add any days since then to the current streak
    const lastDay = sortedDays[sortedDays.length - 1];
    if (lastDay.hasExerciseLogs && currentStreak > 0) {
      const lastWorkoutDate = new Date(lastDay.date);
      const today = new Date();
      const daysSince = Math.floor(
        (today.getTime() - lastWorkoutDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSince >= 0) {
        currentStreak += daysSince;
        longestStreak = Math.max(longestStreak, currentStreak);
      }
    }

    return longestStreak;
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
        completedExercises: sql<number>`
          COUNT(CASE WHEN ${exerciseLogs.id} IS NOT NULL THEN 1 END)
        `,
        hasExerciseLogs: sql<boolean>`
          COUNT(${exerciseLogs.id}) > 0
        `,
      })
      .from(planDays)
      .leftJoin(workoutBlocks, eq(planDays.id, workoutBlocks.planDayId))
      .leftJoin(
        planDayExercises,
        eq(workoutBlocks.id, planDayExercises.workoutBlockId)
      )
      .leftJoin(
        exerciseLogs,
        eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
      )
      .where(eq(planDays.workoutId, workoutId))
      .groupBy(planDays.id, planDays.date)
      .orderBy(asc(planDays.date));

    // Create a map for quick lookup
    const planDayMap = new Map(
      planDayCompletionData.map((day) => [
        day.date,
        {
          completionRate:
            day.totalExercises > 0
              ? Math.round((day.completedExercises / day.totalExercises) * 100)
              : 0,
          hasPlannedWorkout: true,
        },
      ])
    );

    // Map over the 7 dates and return progress data
    return dates.map((date) => {
      const dayData = planDayMap.get(date);
      return {
        date,
        completionRate: dayData?.completionRate || 0,
        hasPlannedWorkout: dayData?.hasPlannedWorkout || false,
      };
    });
  }

  async getWeightProgressionMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<
    { date: string; avgWeight: number; maxWeight: number; label: string }[]
  > {
    // Build basic conditions
    const whereConditions = [
      eq(workouts.userId, userId),
      sql`${exerciseLogs.setsCompleted} > 0`,
      sql`${exerciseLogs.repsCompleted} > 0`,
      // Remove the weight > 0 filter to include bodyweight exercises
    ];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);

      // Filter by plan day date to get workouts planned within the date range
      const startDateStr = start.toISOString().split("T")[0];
      const endDateStr = end.toISOString().split("T")[0];

      if (startDate) {
        whereConditions.push(gte(planDays.date, startDateStr));
      }
      if (endDate) {
        whereConditions.push(lte(planDays.date, endDateStr));
      }
    }

    // Get weight progression data grouped by date
    // Include bodyweight exercises by treating them as having a base weight
    const progressionData = await db
      .select({
        date: planDays.date,
        // For bodyweight exercises, use a base weight of 1 to represent training load
        // For weighted exercises, use actual weight
        avgWeight: sql<number>`
          ROUND(
            AVG(
              CASE 
                WHEN ${exerciseLogs.weightUsed} > 0 THEN CAST(${exerciseLogs.weightUsed} AS DECIMAL)
                ELSE 1.0
              END
            ), 2
          )
        `,
        maxWeight: sql<number>`
          CASE 
            WHEN MAX(${exerciseLogs.weightUsed}) > 0 THEN MAX(${exerciseLogs.weightUsed})
            ELSE 1
          END
        `,
        // Also track total training volume (sets * reps) for better progression tracking
        totalVolume: sql<number>`SUM(${exerciseLogs.setsCompleted} * ${exerciseLogs.repsCompleted})`,
        exerciseCount: sql<number>`COUNT(DISTINCT ${exercises.id})`,
      })
      .from(exerciseLogs)
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
      .where(and(...whereConditions))
      .groupBy(planDays.date)
      .orderBy(asc(planDays.date));

    return progressionData.map((data) => {
      const date = new Date(data.date);
      const label = formatDateForDisplay(date, {
        month: "short",
        day: "numeric",
      });

      // If there are weighted exercises, show weight progression
      // Otherwise, show volume progression (normalized to a weight-like scale)
      const hasWeightedExercises = Number(data.maxWeight) > 1;

      return {
        date: data.date,
        avgWeight: hasWeightedExercises
          ? Number(data.avgWeight) || 0
          : Math.min(Number(data.totalVolume) / 10, 50), // Scale volume to weight-like numbers
        maxWeight: hasWeightedExercises
          ? Number(data.maxWeight) || 0
          : Math.min(Number(data.totalVolume) / 5, 100), // Scale volume to weight-like numbers
        label,
      };
    });
  }

  // New method: Get raw weight accuracy data by date for frontend filtering
  async getWeightAccuracyByDate(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<
    {
      date: string;
      totalSets: number;
      exactMatches: number;
      higherWeight: number;
      lowerWeight: number;
      label: string;
    }[]
  > {
    // Build basic conditions
    const whereConditions = [
      eq(workouts.userId, userId),
      sql`${exerciseLogs.setsCompleted} > 0`,
      sql`${exerciseLogs.repsCompleted} > 0`,
    ];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);

      // Filter by plan day date to get workouts planned within the date range
      const startDateStr = start.toISOString().split("T")[0];
      const endDateStr = end.toISOString().split("T")[0];

      if (startDate) {
        whereConditions.push(gte(planDays.date, startDateStr));
      }
      if (endDate) {
        whereConditions.push(lte(planDays.date, endDateStr));
      }
    }

    // Get all exercise logs with their planned weights, grouped by date
    const dailyExerciseData = await db
      .select({
        date: planDays.date,
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
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .innerJoin(planDays, eq(workoutBlocks.planDayId, planDays.id))
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(exercises, eq(planDayExercises.exerciseId, exercises.id))
      .where(and(...whereConditions))
      .orderBy(asc(planDays.date));

    // Group by date and calculate metrics for each day
    const dailyMetrics = new Map<
      string,
      {
        date: string;
        totalSets: number;
        exactMatches: number;
        higherWeight: number;
        lowerWeight: number;
      }
    >();

    dailyExerciseData.forEach((exercise) => {
      const date = exercise.date;

      if (!dailyMetrics.has(date)) {
        dailyMetrics.set(date, {
          date,
          totalSets: 0,
          exactMatches: 0,
          higherWeight: 0,
          lowerWeight: 0,
        });
      }

      const dayMetric = dailyMetrics.get(date)!;

      // Process exercises with planned weights
      const plannedWeight = exercise.plannedWeight || 0;
      const weightUsed = Number(exercise.weightUsed) || 0;

      // Count this set
      dayMetric.totalSets++;

      if (plannedWeight > 0) {
        // Exercise had planned weight
        if (weightUsed === plannedWeight) {
          dayMetric.exactMatches++;
        } else if (weightUsed > plannedWeight) {
          dayMetric.higherWeight++;
        } else {
          dayMetric.lowerWeight++;
        }
      } else if (weightUsed > 0) {
        // Bodyweight exercise where user added weight
        dayMetric.higherWeight++;
      } else {
        // Pure bodyweight - count as exact match
        dayMetric.exactMatches++;
      }
    });

    // Convert to array and add labels
    return Array.from(dailyMetrics.values()).map((data) => {
      const date = new Date(data.date);
      const label = formatDateForDisplay(date, {
        month: "short",
        day: "numeric",
      });

      return {
        ...data,
        label,
      };
    });
  }

  // New method: Get raw workout type data by date for frontend filtering
  async getWorkoutTypeByDate(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<
    {
      date: string;
      workoutTypes: {
        tag: string;
        label: string;
        totalSets: number;
        totalReps: number;
        exerciseCount: number;
      }[];
      label: string;
    }[]
  > {
    // Build basic conditions
    const whereConditions = [
      eq(workouts.userId, userId),
      sql`${exerciseLogs.setsCompleted} > 0`,
      sql`${exerciseLogs.repsCompleted} > 0`,
    ];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);

      // Filter by plan day date to get workouts planned within the date range
      const startDateStr = start.toISOString().split("T")[0];
      const endDateStr = end.toISOString().split("T")[0];

      if (startDate) {
        whereConditions.push(gte(planDays.date, startDateStr));
      }
      if (endDate) {
        whereConditions.push(lte(planDays.date, endDateStr));
      }
    }

    // Get workout type data grouped by date and exercise tag
    const dailyWorkoutTypeData = await db
      .select({
        date: planDays.date,
        tag: exercises.tag,
        totalSets: sql<number>`COALESCE(SUM(${exerciseLogs.setsCompleted}), 0)::INTEGER`,
        totalReps: sql<number>`COALESCE(SUM(${exerciseLogs.repsCompleted}), 0)::INTEGER`,
        exerciseCount: sql<number>`COUNT(DISTINCT ${exercises.id})::INTEGER`,
      })
      .from(exerciseLogs)
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
      .where(and(...whereConditions))
      .groupBy(planDays.date, exercises.tag)
      .orderBy(
        asc(planDays.date),
        desc(sql`SUM(${exerciseLogs.setsCompleted})`)
      );

    // Group by date
    const dailyMetrics = new Map<
      string,
      {
        date: string;
        workoutTypes: {
          tag: string;
          label: string;
          totalSets: number;
          totalReps: number;
          exerciseCount: number;
        }[];
      }
    >();

    dailyWorkoutTypeData.forEach((data) => {
      const date = data.date;

      if (!dailyMetrics.has(date)) {
        dailyMetrics.set(date, {
          date,
          workoutTypes: [],
        });
      }

      const dayMetric = dailyMetrics.get(date)!;

      if (data.tag) {
        dayMetric.workoutTypes.push({
          tag: data.tag,
          label: DashboardService.workoutTypeLabels[data.tag] || data.tag,
          totalSets: data.totalSets,
          totalReps: data.totalReps,
          exerciseCount: data.exerciseCount,
        });
      }
    });

    // Convert to array and add labels
    return Array.from(dailyMetrics.values()).map((data) => {
      const date = new Date(data.date);
      const label = formatDateForDisplay(date, {
        month: "short",
        day: "numeric",
      });

      return {
        ...data,
        label,
      };
    });
  }

  private async calculateGlobalWorkoutStreak(
    planDayCompletionData: {
      planDayId: number;
      date: string;
      workoutId: number;
      hasExerciseLogs: boolean;
    }[]
  ): Promise<number> {
    if (planDayCompletionData.length === 0) {
      return 0;
    }

    // Sort plan days by date (oldest to newest)
    const sortedDays = planDayCompletionData.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Find the longest streak of following the plan (completing workouts + rest days)
    // A streak continues as long as planned workouts are completed
    // Rest days (gaps between planned workout days) don't break the streak

    let longestStreak = 0;
    let currentStreak = 0;

    // Go through each planned workout day
    for (let i = 0; i < sortedDays.length; i++) {
      const day = sortedDays[i];

      if (day.hasExerciseLogs) {
        // Workout completed - extend current streak
        currentStreak++;

        // Add any rest days between this workout and the previous one
        if (i > 0) {
          const prevDay = new Date(sortedDays[i - 1].date);
          const thisDay = new Date(day.date);
          const daysBetween =
            Math.floor(
              (thisDay.getTime() - prevDay.getTime()) / (1000 * 60 * 60 * 24)
            ) - 1;
          currentStreak += daysBetween; // Add rest days to streak
        }

        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        // Planned workout was missed - reset current streak
        currentStreak = 0;
      }
    }

    // If the last planned workout was completed, add any days since then to the current streak
    const lastDay = sortedDays[sortedDays.length - 1];
    if (lastDay.hasExerciseLogs && currentStreak > 0) {
      const lastWorkoutDate = new Date(lastDay.date);
      const today = new Date();
      const daysSince = Math.floor(
        (today.getTime() - lastWorkoutDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSince >= 0) {
        currentStreak += daysSince;
        longestStreak = Math.max(longestStreak, currentStreak);
      }
    }

    return longestStreak;
  }
}

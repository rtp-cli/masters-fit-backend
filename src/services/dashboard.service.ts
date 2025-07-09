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
import { eq, and, gte, lte, desc, sql, asc, count, inArray } from "drizzle-orm";
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

// Import new modular services
import { MetricsCalculationService } from "./metrics-calculation.service";
import { WorkoutAnalyticsService } from "./workout-analytics.service";
import { GoalProgressService } from "./goal-progress.service";
// Import utilities
import {
  calculateGlobalWorkoutStreak,
  StreakCalculationData,
} from "@/utils/streak-calculation.utils";

export class DashboardService {
  private metricsCalculationService = new MetricsCalculationService();
  private workoutAnalyticsService = new WorkoutAnalyticsService();
  private goalProgressService = new GoalProgressService();

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
    circuit: "Circuit",
    superset: "Superset",
    amrap: "AMRAP",
    emom: "EMOM",
    tabata: "Tabata",
    ladder: "Ladder",
    pyramid: "Pyramid",
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
      this.workoutAnalyticsService.getWorkoutConsistency(
        userId,
        startDate,
        endDate
      ),
      this.metricsCalculationService.getWeightMetrics(
        userId,
        startDate,
        endDate,
        groupBy
      ),
      this.metricsCalculationService.getWeightAccuracyMetrics(
        userId,
        startDate,
        endDate
      ),
      this.goalProgressService.getGoalProgress(userId, startDate, endDate),
      this.metricsCalculationService.getTotalVolumeMetrics(
        userId,
        startDate,
        endDate
      ),
      this.workoutAnalyticsService
        .getWorkoutTypeMetrics(userId, startDate, endDate)
        .catch((error: any) => {
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
        }),
      this.workoutAnalyticsService.getDailyWorkoutProgress(userId),
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
    // Get current week's start and end dates
    const currentDate = getCurrentUTCDate();
    const startOfWeek = new Date(currentDate);
    const dayOfWeek = startOfWeek.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust for Monday start
    startOfWeek.setDate(startOfWeek.getDate() + diff);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);

    const startOfWeekStr = startOfWeek.toISOString().split("T")[0];
    const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

    // Get all plan days for this week
    const allPlanDaysThisWeek = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        workoutId: planDays.workoutId,
      })
      .from(planDays)
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .where(
        and(
          eq(workouts.userId, userId),
          gte(planDays.date, startOfWeekStr),
          lte(planDays.date, endOfWeekStr)
        )
      );

    // Get completion data for this week
    const planDayIds = allPlanDaysThisWeek.map((pd) => pd.planDayId);

    if (planDayIds.length === 0) {
      return {
        workoutCompletionRate: 0,
        exerciseCompletionRate: 0,
        totalWorkoutsThisWeek: 0,
        completedWorkoutsThisWeek: 0,
        streak: await this.calculateWorkoutStreak(userId),
      };
    }

    // Get exercise completion data
    const exerciseCompletionData =
      planDayIds.length > 0
        ? await db
            .select({
              planDayId: workoutBlocks.planDayId,
              totalExercises: sql<number>`COUNT(${planDayExercises.id})`,
              completedExercises: sql<number>`COUNT(${exerciseLogs.id})`,
            })
            .from(workoutBlocks)
            .leftJoin(
              planDayExercises,
              eq(workoutBlocks.id, planDayExercises.workoutBlockId)
            )
            .leftJoin(
              exerciseLogs,
              eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
            )
            .where(inArray(workoutBlocks.planDayId, planDayIds))
            .groupBy(workoutBlocks.planDayId)
        : [];

    // Calculate completion rates
    const totalWorkoutsThisWeek = allPlanDaysThisWeek.length;
    const completedWorkouts = exerciseCompletionData.filter(
      (item) => item.completedExercises > 0
    ).length;

    const totalExercisesThisWeek = exerciseCompletionData.reduce(
      (sum, item) => sum + (item.totalExercises || 0),
      0
    );
    const completedExercisesThisWeek = exerciseCompletionData.reduce(
      (sum, item) => sum + (item.completedExercises || 0),
      0
    );

    const workoutCompletionRate =
      totalWorkoutsThisWeek > 0
        ? Math.round((completedWorkouts / totalWorkoutsThisWeek) * 100)
        : 0;

    const exerciseCompletionRate =
      totalExercisesThisWeek > 0
        ? Math.round(
            (completedExercisesThisWeek / totalExercisesThisWeek) * 100
          )
        : 0;

    const streak = await this.calculateWorkoutStreak(userId);

    return {
      workoutCompletionRate,
      exerciseCompletionRate,
      totalWorkoutsThisWeek: totalWorkoutsThisWeek,
      completedWorkoutsThisWeek: completedWorkouts,
      streak,
    };
  }

  // Delegate methods for backward compatibility
  async getWorkoutConsistency(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<WorkoutConsistency[]> {
    return this.workoutAnalyticsService.getWorkoutConsistency(
      userId,
      startDate,
      endDate
    );
  }

  async getWeightMetrics(
    userId: number,
    startDate?: string,
    endDate?: string,
    groupBy?: "exercise" | "day" | "muscle_group"
  ): Promise<WeightMetrics[]> {
    return this.metricsCalculationService.getWeightMetrics(
      userId,
      startDate,
      endDate,
      groupBy
    );
  }

  async getWeightAccuracyMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<WeightAccuracyMetrics> {
    return this.metricsCalculationService.getWeightAccuracyMetrics(
      userId,
      startDate,
      endDate
    );
  }

  async getGoalProgress(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<GoalProgress[]> {
    return this.goalProgressService.getGoalProgress(userId, startDate, endDate);
  }

  async getWorkoutTypeMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<WorkoutTypeMetrics> {
    return this.workoutAnalyticsService.getWorkoutTypeMetrics(
      userId,
      startDate,
      endDate
    );
  }

  async getTotalVolumeMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<TotalVolumeMetrics[]> {
    return this.metricsCalculationService.getTotalVolumeMetrics(
      userId,
      startDate,
      endDate
    );
  }

  async getDailyWorkoutProgress(
    userId: number
  ): Promise<
    { date: string; completionRate: number; hasPlannedWorkout: boolean }[]
  > {
    return this.workoutAnalyticsService.getDailyWorkoutProgress(userId);
  }

  async getWeightProgressionMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<
    { date: string; avgWeight: number; maxWeight: number; label: string }[]
  > {
    return this.metricsCalculationService.getWeightProgressionMetrics(
      userId,
      startDate,
      endDate
    );
  }

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
    return this.metricsCalculationService.getWeightAccuracyByDate(
      userId,
      startDate,
      endDate
    );
  }

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
    return this.workoutAnalyticsService.getWorkoutTypeByDate(
      userId,
      startDate,
      endDate
    );
  }

  // Utility method that fetches data and delegates calculation to utility function
  private async calculateWorkoutStreak(userId: number): Promise<number> {
    // Get all plan days that have exercises completed, grouped by date and workout
    const planDayCompletionData = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        workoutId: planDays.workoutId,
        hasExerciseLogs: sql<boolean>`COUNT(${exerciseLogs.id}) > 0`,
      })
      .from(planDays)
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(workoutBlocks, eq(planDays.id, workoutBlocks.planDayId))
      .leftJoin(
        planDayExercises,
        eq(workoutBlocks.id, planDayExercises.workoutBlockId)
      )
      .leftJoin(
        exerciseLogs,
        eq(planDayExercises.id, exerciseLogs.planDayExerciseId)
      )
      .where(eq(workouts.userId, userId))
      .groupBy(planDays.id, planDays.date, planDays.workoutId);

    if (planDayCompletionData.length === 0) {
      return 0;
    }

    // Delegate calculation to utility function
    return calculateGlobalWorkoutStreak(
      planDayCompletionData as StreakCalculationData[]
    );
  }
}

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
  resolveTodayString,
  addDays,
} from "@/utils/date.utils";
import { logger } from "@/utils/logger";
import { profileService } from "@/services/profile.service";

// Import new modular services
import { MetricsCalculationService } from "./metrics-calculation.service";
import { WorkoutAnalyticsService } from "./workout-analytics.service";
import { GoalProgressService } from "./goal-progress.service";
// Import utilities
import { calculateScheduledWorkoutStreak } from "@/utils/streak-calculation.utils";

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
    groupBy?: "exercise" | "day" | "muscle_group",
    timezone?: string
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
      this.getWeeklySummary(userId, timezone),
      this.workoutAnalyticsService.getWorkoutConsistency(
        userId,
        startDate,
        endDate,
        timezone
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
      this.workoutAnalyticsService.getDailyWorkoutProgress(userId, timezone),
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

  async getWeeklySummary(
    userId: number,
    timezone?: string
  ): Promise<WeeklySummary> {
    // Resolve the user's local "today" (request tz → profile tz → server/UTC),
    // then compute the Monday–Sunday week window from it using string date math
    // (no UTC Date arithmetic, so it can't shift the day for users west of UTC).
    const profile = await profileService.getProfileByUserId(userId);
    const today = resolveTodayString(profile?.timezone, timezone);

    // Day-of-week for the local date string (Sun=0 … Sat=6); local Date
    // construction from YYYY-MM-DD parts is timezone-safe (no UTC shift).
    const [ty, tm, td] = today.split("-").map(Number);
    const dayOfWeek = new Date(ty, tm - 1, td).getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust for Monday start

    const startOfWeekStr = addDays(today, diff);
    const endOfWeekStr = addDays(startOfWeekStr, 6);

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
        streak: await this.calculateWorkoutStreak(userId, timezone),
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

    const streak = await this.calculateWorkoutStreak(userId, timezone);

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
    endDate?: string,
    timezone?: string
  ): Promise<WorkoutConsistency[]> {
    return this.workoutAnalyticsService.getWorkoutConsistency(
      userId,
      startDate,
      endDate,
      timezone
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
    userId: number,
    timezone?: string
  ): Promise<
    { date: string; completionRate: number; hasPlannedWorkout: boolean }[]
  > {
    return this.workoutAnalyticsService.getDailyWorkoutProgress(
      userId,
      timezone
    );
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

  // Fetches the user's scheduled workout days and delegates streak calculation.
  // Streak = consecutive *completed* scheduled workouts (planDays.isComplete),
  // most recent first; rest days (no plan day) never break it.
  private async calculateWorkoutStreak(
    userId: number,
    timezone?: string
  ): Promise<number> {
    const scheduledDays = await db
      .select({
        date: planDays.date,
        isComplete: planDays.isComplete,
      })
      .from(planDays)
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .where(eq(workouts.userId, userId));

    if (scheduledDays.length === 0) {
      return 0;
    }

    const profile = await profileService.getProfileByUserId(userId);
    const today = resolveTodayString(profile?.timezone, timezone);

    return calculateScheduledWorkoutStreak(
      scheduledDays.map((d) => ({ date: d.date, isComplete: !!d.isComplete })),
      today
    );
  }
}

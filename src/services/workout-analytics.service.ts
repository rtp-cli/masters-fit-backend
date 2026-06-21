import { db } from "@/config/database";
import {
  workouts,
  planDays,
  planDayExercises,
  workoutBlocks,
  exerciseLogs,
  exerciseSetLogs,
  exercises,
} from "@/models";
import { eq, and, gte, lte, desc, sql, count, inArray } from "drizzle-orm";
import {
  WorkoutConsistency,
  WorkoutTypeMetrics,
  WorkoutTypeDistribution,
} from "@/types/dashboard/types";
import {
  getDateRangeUTC,
  formatDateForDisplay,
  resolveTodayString,
  addDays,
} from "@/utils/date.utils";
import { logger } from "@/utils/logger";
import { profileService } from "@/services/profile.service";

export class WorkoutAnalyticsService {
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

  static formatWorkoutTypeLabel(tag: string): string {
    if (!tag) return "";
    const specialCases: Record<string, string> = {
      amrap: "AMRAP",
      emom: "EMOM",
      tabata: "Tabata",
      hiit: "HIIT",
      rft: "RFT",
      ladder: "Ladder",
      pyramid: "Pyramid",
      superset: "Superset",
      circuit: "Circuit",
    };
    if (specialCases[tag.toLowerCase()]) return specialCases[tag.toLowerCase()];
    return tag.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async getWorkoutConsistency(
    userId: number,
    startDate?: string,
    endDate?: string,
    timezone?: string
  ): Promise<WorkoutConsistency[]> {
    const { start, end } = getDateRangeUTC(startDate, endDate);

    // Resolve the user's local "today" for the in-progress/upcoming/completed
    // comparison so it matches their real day (not UTC).
    const profile = await profileService.getProfileByUserId(userId);
    const today = resolveTodayString(profile?.timezone, timezone);

    // Get all workouts for the user within the date range
    const userWorkouts = await db
      .select({
        workoutId: workouts.id,
        workoutName: workouts.name,
        startDate: workouts.startDate,
        endDate: workouts.endDate,
        isActive: workouts.isActive,
      })
      .from(workouts)
      .where(
        and(
          eq(workouts.userId, userId),
          gte(workouts.startDate, start.toISOString().split("T")[0]),
          lte(workouts.endDate, end.toISOString().split("T")[0])
        )
      )
      .orderBy(desc(workouts.startDate));

    if (userWorkouts.length === 0) {
      return [];
    }

    const consistencyData: WorkoutConsistency[] = [];

    for (const workout of userWorkouts) {
      // Get all plan days for this workout
      const planDaysData = await db
        .select({
          planDayId: planDays.id,
          date: planDays.date,
        })
        .from(planDays)
        .where(eq(planDays.workoutId, workout.workoutId))
        .orderBy(planDays.date);

      if (planDaysData.length === 0) continue;

      // Get completion data for this workout
      const planDayIds = planDaysData.map((pd) => pd.planDayId);

      // Get exercise logs to determine completion
      const completionData = await db
        .select({
          planDayId: workoutBlocks.planDayId,
          hasLogs: sql<boolean>`COUNT(${exerciseLogs.id}) > 0`,
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
        .where(
          planDayIds.length > 0
            ? inArray(workoutBlocks.planDayId, planDayIds)
            : sql`1 = 0`
        )
        .groupBy(workoutBlocks.planDayId);

      const completedPlanDayIds = new Set(
        completionData
          .filter((item) => item.hasLogs)
          .map((item) => item.planDayId)
      );

      const totalWorkouts = planDaysData.length;
      const completedWorkouts = completedPlanDayIds.size;
      const completionRate =
        totalWorkouts > 0 ? (completedWorkouts / totalWorkouts) * 100 : 0;

      // Determine week label
      const startDateObj = new Date(workout.startDate);
      const endDateObj = new Date(workout.endDate);
      const weekLabel = `Week 1 (${startDateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}-${endDateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })})`;

      // Determine status by comparing the user's local today (YYYY-MM-DD) to the
      // workout's date-string range (lexicographic compare is correct for ISO dates).
      const isInProgress =
        today >= workout.startDate && today <= workout.endDate;
      const status = isInProgress
        ? "in-progress"
        : today > workout.endDate
          ? "completed"
          : "upcoming";

      consistencyData.push({
        week: workout.startDate,
        weekLabel,
        totalWorkouts,
        completedWorkouts,
        completionRate: Math.round(completionRate),
        isInProgress,
        status,
      });
    }

    return consistencyData;
  }

  async getWorkoutTypeMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<WorkoutTypeMetrics> {
    try {
      // Build basic conditions
      const whereConditions = [eq(workouts.userId, userId)];

      // Add date filters only if dates are provided
      if (startDate || endDate) {
        const { start, end } = getDateRangeUTC(startDate, endDate);
        whereConditions.push(gte(exerciseLogs.createdAt, start));
        whereConditions.push(lte(exerciseLogs.createdAt, end));
      }

      const workoutTypeData = await db
        .select({
          blockName: workoutBlocks.blockName,
          blockType: workoutBlocks.blockType,
          exerciseId: planDayExercises.exerciseId,
          sets: count(exerciseSetLogs.id),
          totalReps: sql<number>`SUM(COALESCE(${exerciseSetLogs.reps}, 0))`,
        })
        .from(exerciseLogs)
        .innerJoin(
          exerciseSetLogs,
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
        .where(and(...whereConditions))
        .groupBy(
          workoutBlocks.blockName,
          workoutBlocks.blockType,
          planDayExercises.exerciseId
        );

      // Group by workout type tag
      const typeMap = new Map<string, WorkoutTypeDistribution>();

      workoutTypeData.forEach((item) => {
        const blockName = (item.blockName || "").toLowerCase();
        const blockType = (item.blockType || "").toLowerCase();

        // Extract tag from block name or type
        let tag = "";
        const tagPatterns = Object.keys(
          WorkoutAnalyticsService.workoutTypeLabels
        );

        // First try block type
        if (blockType && blockType !== "traditional") {
          tag = blockType;
        } else {
          // Then try to extract from block name
          for (const pattern of tagPatterns) {
            if (blockName.includes(pattern.toLowerCase())) {
              tag = pattern;
              break;
            }
          }
        }

        if (!tag) {
          tag = blockName || blockType || "";
        }

        // Filter out warm-up and cool-down exercises
        if (
          tag === "warmup" ||
          tag === "cooldown" ||
          tag === "warm-up" ||
          tag === "cool-down"
        ) {
          return;
        }

        if (!typeMap.has(tag)) {
          typeMap.set(tag, {
            tag,
            label: WorkoutAnalyticsService.formatWorkoutTypeLabel(tag),
            totalSets: 0,
            totalReps: 0,
            exerciseCount: 0,
            completedWorkouts: 0,
            percentage: 0,
            color:
              WorkoutAnalyticsService.workoutTypeColors[tag] ||
              WorkoutAnalyticsService.workoutTypeColors.default,
          });
        }

        const current = typeMap.get(tag)!;
        current.totalSets += item.sets;
        current.totalReps += Number(item.totalReps) || 0;
        current.exerciseCount += 1;
      });

      const distribution = Array.from(typeMap.values());
      const totalExercises = distribution.reduce(
        (sum, item) => sum + item.exerciseCount,
        0
      );
      const totalSets = distribution.reduce(
        (sum, item) => sum + item.totalSets,
        0
      );

      // Calculate percentages
      distribution.forEach((item) => {
        item.percentage =
          totalExercises > 0 ? (item.exerciseCount / totalExercises) * 100 : 0;
      });

      // Sort by percentage descending
      distribution.sort((a, b) => b.percentage - a.percentage);

      const dominantType = distribution.length > 0 ? distribution[0].tag : "";
      const hasData = distribution.length > 0;

      return {
        distribution,
        totalExercises,
        totalSets,
        dominantType,
        hasData,
      };
    } catch (error) {
      logger.error("Error in getWorkoutTypeMetrics", error as Error, {
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
  }

  async getDailyWorkoutProgress(
    userId: number,
    timezone?: string
  ): Promise<
    { date: string; completionRate: number; hasPlannedWorkout: boolean }[]
  > {
    // 1. Find the user's active workout
    const activeWorkout = await db.query.workouts.findFirst({
      where: and(eq(workouts.userId, userId), eq(workouts.isActive, true)),
    });

    // Work in YYYY-MM-DD strings throughout to avoid UTC date shifts.
    let startDateStr: string;
    let endDateStr: string;

    if (activeWorkout) {
      // 2. If an active workout exists, use its date range (stored as date strings)
      startDateStr = activeWorkout.startDate;
      endDateStr = activeWorkout.endDate;
    } else {
      // 3. Fallback to the current calendar week (Monday start) computed from the
      // user's resolved local today via string math (no UTC Date arithmetic).
      const profile = await profileService.getProfileByUserId(userId);
      const today = resolveTodayString(profile?.timezone, timezone);
      const [ty, tm, td] = today.split("-").map(Number);
      const dayOfWeek = new Date(ty, tm - 1, td).getDay(); // Sun=0 … Sat=6
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday is the first day
      startDateStr = addDays(today, diff);
      endDateStr = addDays(startDateStr, 6);
    }

    // Get all plan days with exercise completion counts
    const userPlanDays = await db
      .select({
        planDayId: planDays.id,
        date: planDays.date,
        isComplete: planDays.isComplete,
        totalExercises: sql<number>`COUNT(DISTINCT ${planDayExercises.id})`,
        completedExercises: sql<number>`COUNT(DISTINCT ${exerciseLogs.planDayExerciseId})`,
      })
      .from(planDays)
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .innerJoin(workoutBlocks, eq(workoutBlocks.planDayId, planDays.id))
      .innerJoin(planDayExercises, eq(planDayExercises.workoutBlockId, workoutBlocks.id))
      .leftJoin(exerciseLogs, eq(exerciseLogs.planDayExerciseId, planDayExercises.id))
      .where(
        and(
          eq(workouts.userId, userId),
          gte(planDays.date, startDateStr),
          lte(planDays.date, endDateStr)
        )
      )
      .groupBy(planDays.id, planDays.date, planDays.isComplete)
      .orderBy(planDays.date);

    // Create a map for quick lookup
    const plannedDaysMap = new Map(
      userPlanDays.map((pd) => [
        pd.date,
        {
          id: pd.planDayId,
          isComplete: pd.isComplete,
          totalExercises: Number(pd.totalExercises) || 0,
          completedExercises: Number(pd.completedExercises) || 0,
        },
      ])
    );

    // Generate progress for each day in the range (string date math, no UTC shift)
    const progressData = [];
    let dateStr = startDateStr;

    while (dateStr <= endDateStr) {
      const plannedDay = plannedDaysMap.get(dateStr);

      if (plannedDay) {
        const completionRate = plannedDay.totalExercises > 0
          ? Math.round((plannedDay.completedExercises / plannedDay.totalExercises) * 100)
          : 0;

        progressData.push({
          date: dateStr,
          completionRate,
          hasPlannedWorkout: true,
        });
      } else {
        progressData.push({
          date: dateStr,
          completionRate: 0,
          hasPlannedWorkout: false,
        });
      }

      dateStr = addDays(dateStr, 1);
    }

    return progressData;
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
    // Build basic conditions
    const whereConditions = [eq(workouts.userId, userId)];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);
      whereConditions.push(gte(exerciseLogs.createdAt, start));
      whereConditions.push(lte(exerciseLogs.createdAt, end));
    }

    const workoutTypeByDateData = await db
      .select({
        date: sql<string>`DATE(${exerciseLogs.createdAt})`,
        blockName: workoutBlocks.blockName,
        blockType: workoutBlocks.blockType,
        sets: count(exerciseSetLogs.id),
        totalReps: sql<number>`SUM(COALESCE(${exerciseSetLogs.reps}, 0))`,
        exerciseId: planDayExercises.exerciseId,
      })
      .from(exerciseLogs)
      .innerJoin(
        exerciseSetLogs,
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
      .where(and(...whereConditions))
      .groupBy(
        sql<string>`DATE(${exerciseLogs.createdAt})`,
        workoutBlocks.blockName,
        workoutBlocks.blockType,
        planDayExercises.exerciseId
      )
      .orderBy(sql<string>`DATE(${exerciseLogs.createdAt})`);

    // Group by date
    const groupedData: Record<
      string,
      Map<
        string,
        { totalSets: number; totalReps: number; exerciseCount: number }
      >
    > = {};

    workoutTypeByDateData.forEach(
      ({ date, blockName, blockType, sets, totalReps }) => {
        if (!groupedData[date]) {
          groupedData[date] = new Map();
        }

        const blockNameLower = (blockName || "").toLowerCase();
        const blockTypeLower = (blockType || "").toLowerCase();

        // Extract tag from block name or type
        let tag = "";
        const tagPatterns = Object.keys(
          WorkoutAnalyticsService.workoutTypeLabels
        );

        // First try block type
        if (blockTypeLower && blockTypeLower !== "traditional") {
          tag = blockTypeLower;
        } else {
          // Then try to extract from block name
          for (const pattern of tagPatterns) {
            if (blockNameLower.includes(pattern.toLowerCase())) {
              tag = pattern;
              break;
            }
          }
        }

        if (!tag) {
          tag = blockNameLower || blockTypeLower || "";
        }

        // Filter out warm-up and cool-down exercises
        if (
          tag === "warmup" ||
          tag === "cooldown" ||
          tag === "warm-up" ||
          tag === "cool-down"
        ) {
          return;
        }

        if (!groupedData[date].has(tag)) {
          groupedData[date].set(tag, {
            totalSets: 0,
            totalReps: 0,
            exerciseCount: 0,
          });
        }

        const current = groupedData[date].get(tag)!;
        current.totalSets += sets;
        current.totalReps += totalReps || 0;
        current.exerciseCount += 1;
      }
    );

    return Object.entries(groupedData).map(([date, typeMap]) => ({
      date,
      workoutTypes: Array.from(typeMap.entries()).map(([tag, data]) => ({
        tag,
        label: WorkoutAnalyticsService.formatWorkoutTypeLabel(tag),
        totalSets: data.totalSets,
        totalReps: data.totalReps,
        exerciseCount: data.exerciseCount,
      })),
      label: formatDateForDisplay(date),
    }));
  }
}

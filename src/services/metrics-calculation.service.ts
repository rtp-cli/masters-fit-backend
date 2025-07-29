import { db } from "@/config/database";
import {
  exerciseLogs,
  exerciseSetLogs,
  exercises,
  planDayExercises,
  planDays,
  workouts,
  workoutBlocks,
} from "@/models";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import {
  WeightMetrics,
  WeightAccuracyMetrics,
  TotalVolumeMetrics,
} from "@/types/dashboard/types";
import {
  getDateRangeUTC,
  formatDateForDisplay,
  getCurrentUTCDate,
} from "@/utils/date.utils";

export class MetricsCalculationService {
  async getWeightMetrics(
    userId: number,
    startDate?: string,
    endDate?: string,
    groupBy?: "exercise" | "day" | "muscle_group"
  ): Promise<WeightMetrics[]> {
    // Build basic conditions
    const whereConditions = [
      eq(workouts.userId, userId),
      sql`${exerciseSetLogs.weight} > 0`,
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
          totalWeight: sql<number>`COALESCE(SUM(${exerciseSetLogs.reps} * ${exerciseSetLogs.weight}), 0)::INTEGER`,
          muscleGroups: sql<string[]>`ARRAY[]::text[]`,
        };
        groupByClause = [planDays.date];
        break;
      case "muscle_group":
        selectFields = {
          name: sql<string>`UNNEST(${exercises.muscleGroups})`,
          totalWeight: sql<number>`COALESCE(SUM(${exerciseSetLogs.reps} * ${exerciseSetLogs.weight}), 0)::INTEGER`,
          muscleGroups: sql<string[]>`ARRAY[UNNEST(${exercises.muscleGroups})]`,
        };
        groupByClause = [sql`UNNEST(${exercises.muscleGroups})`];
        break;
      default: // exercise (most useful default)
        selectFields = {
          name: exercises.name,
          totalWeight: sql<number>`COALESCE(SUM(${exerciseSetLogs.reps} * ${exerciseSetLogs.weight}), 0)::INTEGER`,
          muscleGroups: exercises.muscleGroups,
        };
        groupByClause = [exercises.id, exercises.name, exercises.muscleGroups];
    }

    const weightData = await db
      .select(selectFields)
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
      .where(and(...whereConditions))
      .groupBy(...groupByClause)
      .orderBy(
        desc(sql`SUM(${exerciseSetLogs.reps} * ${exerciseSetLogs.weight})`)
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
    const whereConditions = [eq(workouts.userId, userId)];

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

    // Get all exercise set logs with their planned weights
    const allExerciseData = await db
      .select({
        setLogId: exerciseSetLogs.id,
        actualWeight: exerciseSetLogs.weight,
        plannedWeight: planDayExercises.weight,
        exerciseName: exercises.name,
        roundNumber: exerciseSetLogs.roundNumber,
        setNumber: exerciseSetLogs.setNumber,
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
    const plannedWeightSets = allExerciseData.filter(
      (e) => (e.plannedWeight || 0) > 0
    );
    const bodyweightWithAddedWeight = allExerciseData.filter(
      (e) => (e.plannedWeight || 0) === 0 && (Number(e.actualWeight) || 0) > 0
    );

    let totalSets = 0;
    let exactMatches = 0;
    let higherWeight = 0;
    let lowerWeight = 0;
    let weightDifferences: number[] = [];

    // Process sets with planned weights
    plannedWeightSets.forEach((set) => {
      totalSets++;
      const plannedWeight = set.plannedWeight || 0;
      const actualWeight = Number(set.actualWeight) || 0;
      const diff = actualWeight - plannedWeight;
      weightDifferences.push(diff);

      if (actualWeight === plannedWeight) {
        exactMatches++;
      } else if (actualWeight > plannedWeight) {
        higherWeight++;
      } else {
        lowerWeight++;
      }
    });

    // Process bodyweight exercises where user added weight
    bodyweightWithAddedWeight.forEach((set) => {
      totalSets++;
      higherWeight++; // Adding weight to bodyweight exercise counts as "higher"
      weightDifferences.push(Number(set.actualWeight) || 0); // Difference from 0
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
        label: "Under Target",
        value: Math.round((lowerWeight / totalSets) * 100 * 100) / 100,
        color: "#ef4444",
        count: lowerWeight,
      });
    }

    const hasPlannedWeights = plannedWeightSets.length > 0;
    const hasExerciseData = totalSets > 0;

    return {
      accuracyRate: Math.round(accuracyRate),
      totalSets,
      exactMatches,
      higherWeight,
      lowerWeight,
      avgWeightDifference: Math.round(avgWeightDifference),
      chartData,
      hasPlannedWeights,
      hasExerciseData,
    };
  }

  async getTotalVolumeMetrics(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<TotalVolumeMetrics[]> {
    // Build basic conditions
    const whereConditions = [eq(workouts.userId, userId)];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);
      whereConditions.push(gte(exerciseLogs.createdAt, start));
      whereConditions.push(lte(exerciseLogs.createdAt, end));
    }

    const volumeData = await db
      .select({
        date: sql<string>`DATE(${exerciseLogs.createdAt})`,
        totalVolume: sql<number>`COALESCE(SUM(
          CASE 
            WHEN ${exerciseSetLogs.weight} > 0 THEN 
              ${exerciseSetLogs.reps} * ${exerciseSetLogs.weight}
            ELSE 
              ${exerciseSetLogs.reps}
          END
        ), 0)::INTEGER`,
        exerciseCount: sql<number>`COUNT(DISTINCT ${planDayExercises.exerciseId})`,
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
      .where(and(...whereConditions))
      .groupBy(sql<string>`DATE(${exerciseLogs.createdAt})`)
      .orderBy(sql<string>`DATE(${exerciseLogs.createdAt})`);

    return volumeData.map((item) => ({
      date: formatDateForDisplay(item.date),
      totalVolume: item.totalVolume || 0,
      exerciseCount: item.exerciseCount || 0,
      label: formatDateForDisplay(item.date),
    }));
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
      sql`${exerciseSetLogs.weight} > 0`,
    ];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);
      whereConditions.push(gte(exerciseLogs.createdAt, start));
      whereConditions.push(lte(exerciseLogs.createdAt, end));
    }

    const progressionData = await db
      .select({
        date: sql<string>`DATE(${exerciseLogs.createdAt})`,
        avgWeight: sql<number>`AVG(CAST(${exerciseSetLogs.weight} AS REAL))`,
        maxWeight: sql<number>`MAX(CAST(${exerciseSetLogs.weight} AS INTEGER))`,
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
      .where(and(...whereConditions))
      .groupBy(sql<string>`DATE(${exerciseLogs.createdAt})`)
      .orderBy(sql<string>`DATE(${exerciseLogs.createdAt})`);

    return progressionData.map((item) => ({
      date: item.date,
      avgWeight: Math.round(item.avgWeight * 10) / 10,
      maxWeight: item.maxWeight || 0,
      label: formatDateForDisplay(item.date),
    }));
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
    // Build basic conditions
    const whereConditions = [eq(workouts.userId, userId)];

    // Add date filters only if dates are provided
    if (startDate || endDate) {
      const { start, end } = getDateRangeUTC(startDate, endDate);
      whereConditions.push(gte(exerciseLogs.createdAt, start));
      whereConditions.push(lte(exerciseLogs.createdAt, end));
    }

    const accuracyByDateData = await db
      .select({
        date: sql<string>`DATE(${exerciseLogs.createdAt})`,
        plannedWeight: planDayExercises.weight,
        actualWeight: exerciseSetLogs.weight,
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
      .where(and(...whereConditions))
      .orderBy(sql<string>`DATE(${exerciseLogs.createdAt})`);

    // Group by date and calculate accuracy metrics
    const groupedData: Record<
      string,
      { plannedWeight: number; actualWeight: number }[]
    > = {};

    accuracyByDateData.forEach(({ date, plannedWeight, actualWeight }) => {
      if (!groupedData[date]) {
        groupedData[date] = [];
      }
      groupedData[date].push({
        plannedWeight: plannedWeight || 0,
        actualWeight: Number(actualWeight) || 0,
      });
    });

    return Object.entries(groupedData).map(([date, entries]) => {
      const totalSets = entries.length;
      let exactMatches = 0;
      let higherWeight = 0;
      let lowerWeight = 0;

      entries.forEach(({ plannedWeight, actualWeight }) => {
        if (plannedWeight === 0 && actualWeight === 0) {
          exactMatches++;
        } else if (plannedWeight === 0 && actualWeight > 0) {
          higherWeight++; // Added weight to bodyweight exercise
        } else if (actualWeight === plannedWeight) {
          exactMatches++;
        } else if (actualWeight > plannedWeight) {
          higherWeight++;
        } else {
          lowerWeight++;
        }
      });

      return {
        date,
        totalSets,
        exactMatches,
        higherWeight,
        lowerWeight,
        label: formatDateForDisplay(date),
      };
    });
  }
}

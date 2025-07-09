import { getCurrentUTCDate } from "@/utils/date.utils";

export interface StreakCalculationData {
  planDayId: number;
  date: string;
  workoutId: number;
  hasExerciseLogs: boolean;
}

export interface ActiveWorkoutStreakData {
  planDayId: number;
  date: string;
  hasExerciseLogs: boolean;
}

/**
 * Calculate the global workout streak for a user
 * Any workout completed on a day counts toward the streak
 */
export function calculateGlobalWorkoutStreak(
  planDayCompletionData: StreakCalculationData[]
): number {
  const currentDate = getCurrentUTCDate();
  const today = currentDate.toISOString().split("T")[0];

  // Get all completed workouts, grouped by date (any workout completed on a day counts)
  const completedDates = planDayCompletionData
    .filter((item) => item.hasExerciseLogs && item.date <= today)
    .reduce(
      (acc, item) => {
        if (!acc.some((d) => d.date === item.date)) {
          acc.push({ date: item.date });
        }
        return acc;
      },
      [] as { date: string }[]
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (completedDates.length === 0) {
    return 0;
  }

  let streak = 0;
  let expectedDate = new Date(completedDates[0].date);

  for (const { date } of completedDates) {
    const currentWorkoutDate = new Date(date);
    const daysDiff = Math.floor(
      (expectedDate.getTime() - currentWorkoutDate.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    if (streak === 0) {
      // First workout - check if it's recent
      const daysSinceToday = Math.floor(
        (currentDate.getTime() - currentWorkoutDate.getTime()) /
          (1000 * 60 * 60 * 24)
      );
      if (daysSinceToday <= 7) {
        // Allow up to 7 days gap for the first workout
        streak = 1;
        expectedDate = new Date(currentWorkoutDate);
        expectedDate.setDate(expectedDate.getDate() - 1); // Expect previous day for next iteration
      } else {
        break;
      }
    } else if (daysDiff <= 7) {
      // Allow up to 7 days between workouts
      streak++;
      expectedDate = new Date(currentWorkoutDate);
      expectedDate.setDate(expectedDate.getDate() - 1);
    } else {
      // Gap too large, streak broken
      break;
    }
  }

  return streak;
}

/**
 * Calculate streak for a specific active workout
 */
export function calculateActiveWorkoutStreak(
  planDayCompletionData: ActiveWorkoutStreakData[]
): number {
  const currentDate = getCurrentUTCDate();
  const today = currentDate.toISOString().split("T")[0];

  // Filter data for completed workouts and sort by date descending
  const workoutData = planDayCompletionData
    .filter((item) => item.hasExerciseLogs && item.date <= today)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (workoutData.length === 0) {
    return 0;
  }

  let streak = 0;
  let currentStreakDate = new Date(workoutData[0].date);

  for (const data of workoutData) {
    const dataDate = new Date(data.date);
    const daysDiff = Math.floor(
      (currentStreakDate.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (streak === 0) {
      // First workout - check if it's recent
      const daysSinceToday = Math.floor(
        (currentDate.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceToday <= 7) {
        // Allow up to 7 days gap for the first workout
        streak = 1;
        currentStreakDate = dataDate;
      } else {
        break;
      }
    } else if (daysDiff <= 7) {
      // Allow up to 7 days between workouts
      streak++;
      currentStreakDate = dataDate;
    } else {
      // Gap too large, streak broken
      break;
    }
  }

  return streak;
}

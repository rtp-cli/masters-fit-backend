import { FitnessGoals } from "@/constants/profile";

export interface WeeklySummary {
  workoutCompletionRate: number;
  exerciseCompletionRate: number;
  streak: number;
  totalWorkoutsThisWeek: number;
  completedWorkoutsThisWeek: number;
}

export interface WorkoutConsistency {
  week: string;
  weekLabel: string;
  totalWorkouts: number;
  completedWorkouts: number;
  completionRate: number;
  isInProgress: boolean;
  status: "completed" | "in-progress" | "upcoming";
}

export interface WeightMetrics {
  name: string;
  totalWeight: number;
  muscleGroups: string[];
}

export interface WeightAccuracyMetrics {
  accuracyRate: number;
  totalSets: number;
  exactMatches: number;
  higherWeight: number;
  lowerWeight: number;
  avgWeightDifference: number;
  chartData: Array<{
    label: string;
    value: number;
    color: string;
    count?: number;
  }>;
  hasPlannedWeights?: boolean;
  hasExerciseData?: boolean;
}

export interface GoalProgress {
  goal: string;
  progressScore: number;
  totalSets: number;
  totalReps: number;
  totalWeight: number;
  completedWorkouts: number;
}

export interface TotalVolumeMetrics {
  date: string;
  totalVolume: number;
  exerciseCount: number;
  label: string; // e.g., "Jun 1" or "Week 1"
}

export interface DashboardMetrics {
  weeklySummary: WeeklySummary;
  workoutConsistency: WorkoutConsistency[];
  weightMetrics: WeightMetrics[];
  weightAccuracy: WeightAccuracyMetrics;
  goalProgress: GoalProgress[];
  totalVolumeMetrics: TotalVolumeMetrics[];
}

export type MuscleGroupGoalMapping = {
  [key in (typeof FitnessGoals)[keyof typeof FitnessGoals]]: string[];
};

export interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  groupBy?: "exercise" | "day" | "muscle_group";
  timeRange?: "1w" | "1m" | "3m" | "6m" | "1y";
}

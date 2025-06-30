import { ApiResponse } from "@/types/common/responses";
import {
  DashboardMetrics,
  WeeklySummary,
  WorkoutConsistency,
  WeightMetrics,
  WeightAccuracyMetrics,
  GoalProgress,
  TotalVolumeMetrics,
  WorkoutTypeMetrics,
} from "./types";

export interface DashboardMetricsResponse
  extends ApiResponse<DashboardMetrics> {
  success: true;
  data: DashboardMetrics;
}

export interface WeeklySummaryResponse extends ApiResponse<WeeklySummary> {
  success: true;
  data: WeeklySummary;
}

export interface WorkoutConsistencyResponse
  extends ApiResponse<WorkoutConsistency[]> {
  success: true;
  data: WorkoutConsistency[];
}

export interface WeightMetricsResponse extends ApiResponse<WeightMetrics[]> {
  success: true;
  data: WeightMetrics[];
}

export interface WeightAccuracyResponse
  extends ApiResponse<WeightAccuracyMetrics> {
  success: true;
  data: WeightAccuracyMetrics;
}

export interface TotalVolumeMetricsResponse
  extends ApiResponse<TotalVolumeMetrics[]> {
  success: true;
  data: TotalVolumeMetrics[];
}

export interface WorkoutTypeMetricsResponse
  extends ApiResponse<WorkoutTypeMetrics> {
  success: true;
  data: WorkoutTypeMetrics;
}

export interface GoalProgressResponse extends ApiResponse<GoalProgress[]> {
  success: true;
  data: GoalProgress[];
}

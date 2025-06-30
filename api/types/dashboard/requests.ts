export interface GetDashboardMetricsRequest {
  startDate?: string;
  endDate?: string;
  timeRange?: "1w" | "1m" | "3m" | "6m" | "1y";
}

export interface GetWeightMetricsRequest {
  startDate?: string;
  endDate?: string;
  groupBy?: "exercise" | "day" | "muscle_group";
  timeRange?: "1w" | "1m" | "3m" | "6m" | "1y";
}

export interface GetWorkoutConsistencyRequest {
  startDate?: string;
  endDate?: string;
  timeRange?: "1w" | "1m" | "3m" | "6m" | "1y";
}

export interface GetGoalProgressRequest {
  startDate?: string;
  endDate?: string;
  timeRange?: "1w" | "1m" | "3m" | "6m" | "1y";
}

export interface GetWeightAccuracyRequest {
  startDate?: string;
  endDate?: string;
  timeRange?: "1w" | "1m" | "3m" | "6m" | "1y";
}

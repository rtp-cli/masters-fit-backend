import {
  Controller,
  Get,
  Path,
  Query,
  Route,
  Response,
  SuccessResponse,
  Tags,
  Example,
  Security,
} from "@tsoa/runtime";
import {
  DashboardMetricsResponse,
  WeeklySummaryResponse,
  WorkoutConsistencyResponse,
  WeightMetricsResponse,
  WeightAccuracyResponse,
  GoalProgressResponse,
  TotalVolumeMetricsResponse,
} from "@/types/dashboard/responses";
import {
  GetDashboardMetricsRequest,
  GetWeightMetricsRequest,
  GetWorkoutConsistencyRequest,
  GetGoalProgressRequest,
  GetWeightAccuracyRequest,
} from "@/types/dashboard/requests";
import { dashboardService } from "@/services";

@Route("dashboard")
@Tags("Dashboard")
@Security("bearerAuth")
export class DashboardController extends Controller {
  /**
   * Get comprehensive dashboard metrics for a user
   */
  @Get("/{userId}/metrics")
  @Response<DashboardMetricsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<DashboardMetricsResponse>({
    success: true,
    data: {
      weeklySummary: {
        workoutCompletionRate: 85,
        exerciseCompletionRate: 92,
        streak: 5,
        totalWorkoutsThisWeek: 4,
        completedWorkoutsThisWeek: 3,
      },
      workoutConsistency: [
        {
          week: "2024-01-01",
          weekLabel: "Week 1 (Jan 1-7)",
          totalWorkouts: 4,
          completedWorkouts: 3,
          completionRate: 75,
          isInProgress: false,
          status: "completed",
        },
      ],
      weightMetrics: [
        {
          name: "Bench Press",
          totalWeight: 2400,
          muscleGroups: ["chest", "shoulders", "triceps"],
        },
      ],
      weightAccuracy: {
        accuracyRate: 78,
        totalSets: 50,
        exactMatches: 39,
        higherWeight: 8,
        lowerWeight: 3,
        avgWeightDifference: 2.5,
        chartData: [
          { label: "Exact Weight", value: 39, color: "#10b981" },
          { label: "Higher Weight", value: 8, color: "#f59e0b" },
          { label: "Lower Weight", value: 3, color: "#ef4444" },
        ],
      },
      goalProgress: [
        {
          goal: "muscle_gain",
          progressScore: 65,
          totalSets: 120,
          totalReps: 1440,
          totalWeight: 14400,
          completedWorkouts: 12,
        },
      ],
      totalVolumeMetrics: [
        {
          date: "2024-01-01",
          totalVolume: 2400,
          exerciseCount: 4,
          label: "Jan 1",
        },
      ],
    },
  })
  public async getDashboardMetrics(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y",
    @Query() groupBy?: "exercise" | "day" | "muscle_group"
  ): Promise<DashboardMetricsResponse> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await dashboardService.getDashboardMetrics(
      userId,
      start,
      end,
      groupBy
    );

    return {
      success: true,
      data,
    };
  }

  /**
   * Get weekly summary for a user
   */
  @Get("/{userId}/weekly-summary")
  @Response<WeeklySummaryResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<WeeklySummaryResponse>({
    success: true,
    data: {
      workoutCompletionRate: 85,
      exerciseCompletionRate: 92,
      streak: 5,
      totalWorkoutsThisWeek: 4,
      completedWorkoutsThisWeek: 3,
    },
  })
  public async getWeeklySummary(
    @Path() userId: number
  ): Promise<WeeklySummaryResponse> {
    const data = await dashboardService.getWeeklySummary(userId);

    return {
      success: true,
      data,
    };
  }

  /**
   * Get workout consistency data for a user
   */
  @Get("/{userId}/workout-consistency")
  @Response<WorkoutConsistencyResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<WorkoutConsistencyResponse>({
    success: true,
    data: [
      {
        week: "2024-01-01",
        weekLabel: "Week 1 (Jan 1-7)",
        totalWorkouts: 4,
        completedWorkouts: 3,
        completionRate: 75,
        isInProgress: false,
        status: "completed",
      },
      {
        week: "2024-01-08",
        weekLabel: "Week 2 (Jan 8-14)",
        totalWorkouts: 4,
        completedWorkouts: 4,
        completionRate: 100,
        isInProgress: false,
        status: "completed",
      },
    ],
  })
  public async getWorkoutConsistency(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<WorkoutConsistencyResponse> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await dashboardService.getWorkoutConsistency(
      userId,
      start,
      end
    );

    return {
      success: true,
      data,
    };
  }

  /**
   * Get weight metrics for a user
   */
  @Get("/{userId}/weight-metrics")
  @Response<WeightMetricsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<WeightMetricsResponse>({
    success: true,
    data: [
      {
        name: "Bench Press",
        totalWeight: 2400,
        muscleGroups: ["chest", "shoulders", "triceps"],
      },
      {
        name: "Squat",
        totalWeight: 3200,
        muscleGroups: ["legs", "glutes", "core"],
      },
    ],
  })
  public async getWeightMetrics(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() groupBy?: "exercise" | "day" | "muscle_group",
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<WeightMetricsResponse> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await dashboardService.getWeightMetrics(
      userId,
      start,
      end,
      groupBy
    );

    return {
      success: true,
      data,
    };
  }

  /**
   * Get weight accuracy metrics for a user
   */
  @Get("/{userId}/weight-accuracy")
  @Response<WeightAccuracyResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<WeightAccuracyResponse>({
    success: true,
    data: {
      accuracyRate: 78,
      totalSets: 50,
      exactMatches: 39,
      higherWeight: 8,
      lowerWeight: 3,
      avgWeightDifference: 2.5,
      chartData: [
        { label: "Exact Weight", value: 39, color: "#10b981" },
        { label: "Higher Weight", value: 8, color: "#f59e0b" },
        { label: "Lower Weight", value: 3, color: "#ef4444" },
      ],
    },
  })
  public async getWeightAccuracy(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<WeightAccuracyResponse> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await dashboardService.getWeightAccuracyMetrics(
      userId,
      start,
      end
    );

    return {
      success: true,
      data,
    };
  }

  /**
   * Get goal progress for a user
   */
  @Get("/{userId}/goal-progress")
  @Response<GoalProgressResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<GoalProgressResponse>({
    success: true,
    data: [
      {
        goal: "muscle_gain",
        progressScore: 65,
        totalSets: 120,
        totalReps: 1440,
        totalWeight: 14400,
        completedWorkouts: 12,
      },
      {
        goal: "strength",
        progressScore: 72,
        totalSets: 95,
        totalReps: 760,
        totalWeight: 18200,
        completedWorkouts: 10,
      },
    ],
  })
  public async getGoalProgress(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<GoalProgressResponse> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await dashboardService.getGoalProgress(userId, start, end);

    return {
      success: true,
      data,
    };
  }

  /**
   * Get total volume metrics for a user (strength progress over time)
   */
  @Get("/{userId}/total-volume")
  @Response<TotalVolumeMetricsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<TotalVolumeMetricsResponse>({
    success: true,
    data: [
      {
        date: "2024-01-01",
        totalVolume: 2400,
        exerciseCount: 4,
        label: "Jan 1",
      },
      {
        date: "2024-01-02",
        totalVolume: 2800,
        exerciseCount: 5,
        label: "Jan 2",
      },
    ],
  })
  public async getTotalVolumeMetrics(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<TotalVolumeMetricsResponse> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await dashboardService.getTotalVolumeMetrics(
      userId,
      start,
      end
    );

    return {
      success: true,
      data,
    };
  }

  /**
   * Helper method to parse time range into start and end dates
   */
  private parseTimeRange(
    timeRange?: string,
    startDate?: string,
    endDate?: string
  ): { startDate?: string; endDate?: string } {
    if (startDate && endDate) {
      return { startDate, endDate };
    }

    const now = new Date();
    const end = endDate || now.toISOString().split("T")[0];

    if (!timeRange) {
      return { startDate, endDate: end };
    }

    let start: Date;
    switch (timeRange) {
      case "1w":
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "1m":
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "3m":
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "6m":
        start = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        break;
      case "1y":
        start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return {
      startDate: startDate || start.toISOString().split("T")[0],
      endDate: end,
    };
  }
}

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
  WorkoutTypeMetricsResponse,
} from "@/types/dashboard/responses";
import {
  GetDashboardMetricsRequest,
  GetWeightMetricsRequest,
  GetWorkoutConsistencyRequest,
  GetGoalProgressRequest,
  GetWeightAccuracyRequest,
} from "@/types/dashboard/requests";
import { DashboardService } from "@/services";

@Route("dashboard")
@Tags("Dashboard")
@Security("bearerAuth")
export class DashboardController extends Controller {
  private dashboardService = new DashboardService();

  /**
   * Get comprehensive dashboard metrics for a user
   */
  @Get("/{userId}/metrics")
  @Response<DashboardMetricsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
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

    const data = await this.dashboardService.getDashboardMetrics(
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
  public async getWeeklySummary(
    @Path() userId: number
  ): Promise<WeeklySummaryResponse> {
    const data = await this.dashboardService.getWeeklySummary(userId);

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

    const data = await this.dashboardService.getWorkoutConsistency(
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

    const data = await this.dashboardService.getWeightMetrics(
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

    const data = await this.dashboardService.getWeightAccuracyMetrics(
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

    const data = await this.dashboardService.getGoalProgress(
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
   * Get total volume metrics for a user (strength progress over time)
   */
  @Get("/{userId}/total-volume")
  @Response<TotalVolumeMetricsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
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

    const data = await this.dashboardService.getTotalVolumeMetrics(
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
   * Get workout type distribution metrics for a user
   */
  @Get("/{userId}/workout-type-metrics")
  @Response<WorkoutTypeMetricsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWorkoutTypeMetrics(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<WorkoutTypeMetricsResponse> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await this.dashboardService.getWorkoutTypeMetrics(
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
   * Get weight progression metrics for a user
   */
  @Get("/{userId}/weight-progression")
  @Response<{
    success: boolean;
    data: {
      date: string;
      avgWeight: number;
      maxWeight: number;
      label: string;
    }[];
  }>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWeightProgressionMetrics(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<{
    success: boolean;
    data: {
      date: string;
      avgWeight: number;
      maxWeight: number;
      label: string;
    }[];
  }> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await this.dashboardService.getWeightProgressionMetrics(
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
   * Get raw weight accuracy data by date for frontend filtering
   */
  @Get("/{userId}/weight-accuracy-by-date")
  @Response<{
    success: boolean;
    data: {
      date: string;
      totalSets: number;
      exactMatches: number;
      higherWeight: number;
      lowerWeight: number;
      label: string;
    }[];
  }>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWeightAccuracyByDate(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<{
    success: boolean;
    data: {
      date: string;
      totalSets: number;
      exactMatches: number;
      higherWeight: number;
      lowerWeight: number;
      label: string;
    }[];
  }> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await this.dashboardService.getWeightAccuracyByDate(
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
   * Get raw workout type data by date for frontend filtering
   */
  @Get("/{userId}/workout-type-by-date")
  @Response<{
    success: boolean;
    data: {
      date: string;
      workoutTypes: {
        tag: string;
        label: string;
        totalSets: number;
        totalReps: number;
        exerciseCount: number;
      }[];
      label: string;
    }[];
  }>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWorkoutTypeByDate(
    @Path() userId: number,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() timeRange?: "1w" | "1m" | "3m" | "6m" | "1y"
  ): Promise<{
    success: boolean;
    data: {
      date: string;
      workoutTypes: {
        tag: string;
        label: string;
        totalSets: number;
        totalReps: number;
        exerciseCount: number;
      }[];
      label: string;
    }[];
  }> {
    const { startDate: start, endDate: end } = this.parseTimeRange(
      timeRange,
      startDate,
      endDate
    );

    const data = await this.dashboardService.getWorkoutTypeByDate(
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

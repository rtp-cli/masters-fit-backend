import { insertExerciseLogSchema } from "@/models";
import { logsService } from "@/services";
import { ApiResponse, ExerciseLogsResponse } from "@/types";
import {
  Body,
  Controller,
  Post,
  Route,
  Response,
  SuccessResponse,
  Tags,
  Get,
  Path,
  Example,
  Security,
} from "@tsoa/runtime";

@Route("logs")
@Tags("Logs")
@Security("bearerAuth")
export class LogsController extends Controller {
  /**
   * Create exercise log
   * @param requestBody Exercise log data
   */
  @Post("/")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createExerciseLog(
    @Body() requestBody: any
  ): Promise<ApiResponse> {
    const validatedData = insertExerciseLogSchema.parse(requestBody);
    await logsService.createExerciseLog(validatedData);
    return {
      success: true,
    };
  }

  /**
   * Get exercise logs for a plan day
   * @param planDayId Plan day ID
   */
  @Get("/{planDayId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getExerciseLogsForPlanDay(
    @Path() planDayId: number
  ): Promise<ExerciseLogsResponse> {
    const exerciseLogs = await logsService.getExerciseLogsForPlanDay(planDayId);
    return {
      success: true,
      logs: exerciseLogs,
    };
  }
}

export const logsController = new LogsController();

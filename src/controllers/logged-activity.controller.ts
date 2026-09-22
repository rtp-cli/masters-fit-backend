import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "@tsoa/runtime";

import {
  createLoggedActivitySchema,
  type LoggedActivity,
} from "@/models/logged-activity.schema";
import { loggedActivityService } from "@/services/logged-activity.service";
import { ApiResponse } from "@/types/common/responses";

interface ListActivitiesResponse extends ApiResponse {
  activities: LoggedActivity[];
}

interface CreateActivityResponse extends ApiResponse {
  activity?: LoggedActivity;
}

/**
 * [LR-077] Recording something the user already did, outside any plan.
 *
 * There is no generation anywhere in this controller and there must not be:
 * conflating "record what happened" with "prescribe something" is what produced
 * the sauna-as-an-exercise hallucination.
 */
@Route("activities")
@Tags("Activities")
@Security("bearerAuth")
export class LoggedActivityController extends Controller {
  /**
   * Log an activity. The user is taken from the session, never the body.
   *
   * `today` is the caller's LOCAL date, sent by the client, because the server
   * cannot know what day it is where the user is standing.
   */
  @Post("/")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createActivity(
    @Request() request: any,
    @Body() requestBody: any
  ): Promise<CreateActivityResponse> {
    const userId: number = request.userId;

    const { today, ...activity } = requestBody ?? {};
    const validated = createLoggedActivitySchema.parse(activity);

    const localToday =
      typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
        ? today
        : // No usable client date: fall back to the server's. A user one
          // timezone ahead could then be told their evening walk is "in the
          // future", so the client always sends it — this is the floor, not
          // the expected path.
          new Date().toISOString().slice(0, 10);

    const created = await loggedActivityService.createActivity(
      userId,
      validated,
      localToday
    );

    this.setStatus(201);
    return { success: true, activity: created };
  }

  /**
   * The caller's activities, optionally within a date window. The calendar asks
   * for a month; the dashboard asks for one day.
   */
  @Get("/")
  @SuccessResponse(200, "Success")
  public async listActivities(
    @Request() request: any,
    @Query() startDate?: string,
    @Query() endDate?: string
  ): Promise<ListActivitiesResponse> {
    const userId: number = request.userId;
    const activities = await loggedActivityService.listActivities(
      userId,
      startDate,
      endDate
    );
    return { success: true, activities };
  }

  /**
   * Remove one. Scoped to the caller inside the service, so an id belonging to
   * someone else is a 404 rather than a deletion.
   */
  @Delete("/{activityId}")
  @Response<ApiResponse>(404, "Not Found")
  @SuccessResponse(200, "Success")
  public async deleteActivity(
    @Request() request: any,
    @Path() activityId: number
  ): Promise<ApiResponse> {
    const userId: number = request.userId;
    await loggedActivityService.deleteActivity(userId, activityId);
    return { success: true };
  }
}

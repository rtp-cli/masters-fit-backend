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
import { searchService } from "@/services";
import {
  DateSearchResponse,
  ExerciseSearchResponse,
  ApiResponse,
} from "@/types";

@Route("search")
@Tags("Search")
@Security("bearerAuth")
export class SearchController extends Controller {
  /**
   * Search for workout by date
   * @param userId User ID
   * @param date Date in YYYY-MM-DD format
   */
  @Get("/date/{userId}")
  @Response<ApiResponse>(400, "Bad Request")
  @Response<ApiResponse>(404, "Not Found")
  @SuccessResponse(200, "Success")
  public async searchByDate(
    @Path() userId: number,
    @Query() date: string
  ): Promise<DateSearchResponse> {
    const result = await searchService.searchByDate(userId, date);
    return result;
  }

  /**
   * Search for exercise details and user stats
   * @param userId User ID
   * @param exerciseId Exercise ID
   */
  @Get("/exercise/{userId}/{exerciseId}")
  @Response<ApiResponse>(400, "Bad Request")
  @Response<ApiResponse>(404, "Not Found")
  @SuccessResponse(200, "Success")
  public async searchExercise(
    @Path() userId: number,
    @Path() exerciseId: number
  ): Promise<ExerciseSearchResponse> {
    const result = await searchService.searchExercise(userId, exerciseId);
    return result;
  }

  /**
   * Search exercises by name or muscle group
   * @param query Search query
   */
  @Get("/exercises")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async searchExercises(
    @Query() query: string
  ): Promise<{ success: boolean; exercises: any[] }> {
    const exercises = await searchService.searchExercises(query);
    return {
      success: true,
      exercises,
    };
  }
}

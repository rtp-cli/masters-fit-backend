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
   * Search exercises by name or muscle group (legacy endpoint)
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

  /**
   * Enhanced search exercises with filtering options
   * @param userId User ID for equipment filtering
   * @param query Search query (optional)
   * @param muscleGroups Muscle groups filter (optional)
   * @param equipment Equipment filter (optional)
   * @param difficulty Difficulty filter (optional)
   * @param excludeId Exercise ID to exclude (optional)
   * @param userEquipmentOnly Auto-filter by user's equipment (default: true)
   * @param limit Maximum number of results (default: 20)
   */
  @Get("/exercises/filtered/{userId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async searchExercisesWithFilters(
    @Path() userId: number,
    @Query() query?: string,
    @Query() muscleGroups?: string,
    @Query() equipment?: string,
    @Query() difficulty?: string,
    @Query() excludeId?: number,
    @Query() userEquipmentOnly?: boolean,
    @Query() limit?: number
  ): Promise<{
    success: boolean;
    exercises: any[];
    appliedFilters: {
      equipment?: string[];
      difficulty?: string;
      userEquipmentOnly?: boolean;
    };
  }> {
    const options = {
      query,
      muscleGroups: muscleGroups ? muscleGroups.split(",").map(g => g.trim()).filter(g => g.length > 0) : undefined,
      equipment: equipment ? equipment.split(",").map(e => e.trim()).filter(e => e.length > 0) : undefined,
      difficulty,
      excludeId,
      userEquipmentOnly: userEquipmentOnly ?? true,
      limit: limit ?? 20,
    };

    const result = await searchService.searchExercisesWithFilters(userId, options);
    return {
      success: true,
      exercises: result.exercises,
      appliedFilters: result.appliedFilters,
    };
  }

  /**
   * Get available filter options for exercise search
   */
  @Get("/filters")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getFilterOptions(): Promise<{
    success: boolean;
    equipment: string[];
    muscleGroups: string[];
    difficulty: string[];
  }> {
    const result = await searchService.getFilterOptions();
    return {
      success: true,
      equipment: result.equipment,
      muscleGroups: result.muscleGroups,
      difficulty: result.difficulty,
    };
  }
}

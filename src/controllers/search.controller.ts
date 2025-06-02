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
  @Example<DateSearchResponse>({
    success: true,
    date: "2024-01-15",
    workout: {
      id: 1,
      name: "Upper Body Strength",
      description: "Focus on upper body muscles",
      completed: false,
      planDay: {
        id: 1,
        date: new Date("2024-01-15"),
        exercises: [
          {
            id: 1,
            exercise: {
              id: 1,
              name: "Push-ups",
              description: "Classic bodyweight exercise",
              muscleGroups: ["Chest", "Shoulders"],
              equipment: ["None"],
              difficulty: "beginner",
              instructions: "Lower your body to the ground and push back up",
            },
            sets: 3,
            reps: 12,
            weight: null,
            duration: null,
            completed: false,
            completionRate: 0,
          },
        ],
      },
      overallCompletionRate: 0,
    },
  })
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
  @Example<ExerciseSearchResponse>({
    success: true,
    exercise: {
      id: 1,
      name: "Push-ups",
      description: "Classic bodyweight exercise",
      muscleGroups: ["Chest", "Shoulders", "Triceps"],
      equipment: ["None"],
      difficulty: "beginner",
      instructions: "Lower your body to the ground and push back up",
      created_at: new Date(),
      updated_at: new Date(),
    },
    userStats: {
      totalAssignments: 15,
      totalCompletions: 12,
      completionRate: 80,
      averageSets: 3.2,
      averageReps: 11.5,
      averageWeight: null,
      lastPerformed: new Date("2024-01-10"),
      personalRecord: {
        maxWeight: null,
        maxReps: 15,
        maxSets: 4,
      },
    },
  })
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

import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Put,
  Route,
  Response,
  SuccessResponse,
  Tags,
  Example,
  Security,
} from "@tsoa/runtime";
import {
  ApiResponse,
  Exercise,
  ExercisesResponse,
  ExerciseResponse,
} from "@/types/exercise/responses";
import { exerciseService } from "@/services";
import { insertExerciseSchema } from "@/models";
import { validateExerciseLink } from "@/utils/linkUtils";

@Route("exercises")
@Tags("Exercises")
@Security("bearerAuth")
export class ExerciseController extends Controller {
  /**
   * Get all exercises
   */
  @Get("/")
  @Response<ExercisesResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<ExercisesResponse>({
    success: true,
    exercises: [
      {
        id: 1,
        name: "Push-up",
        description: "A classic bodyweight exercise",
        category: "strength",
        difficulty: "beginner",
        equipment: "none",
        muscles_targeted: ["chest", "shoulders", "triceps"],
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
  })
  public async getExercises(): Promise<ExercisesResponse> {
    const dbExercises = await exerciseService.getExercises();
    const exercises: Exercise[] = dbExercises.map((ex) => ({
      id: ex.id,
      name: ex.name,
      description: ex.description || undefined,
      category: ex.muscleGroups[0], // Using first muscle group as category
      difficulty: ex.difficulty || "beginner",
      equipment: ex.equipment?.join(", ") || undefined,
      link: ex.link || undefined,
      muscles_targeted: ex.muscleGroups,
      created_at: ex.createdAt,
      updated_at: ex.updatedAt,
    }));
    return {
      success: true,
      exercises,
    };
  }

  /**
   * Get exercise by ID
   * @param id Exercise ID
   */
  @Get("/{id}")
  @Response<ExerciseResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  @Example<ExerciseResponse>({
    success: true,
    exercise: {
      id: 1,
      name: "Push-up",
      description: "A classic bodyweight exercise",
      category: "strength",
      difficulty: "beginner",
      equipment: "none",
      muscles_targeted: ["chest", "shoulders", "triceps"],
      created_at: new Date(),
      updated_at: new Date(),
    },
  })
  public async getExercise(@Path() id: number): Promise<ExerciseResponse> {
    const dbExercise = await exerciseService.getExerciseById(id);
    if (!dbExercise) {
      throw new Error("Exercise not found");
    }
    const exercise: Exercise = {
      id: dbExercise.id,
      name: dbExercise.name,
      description: dbExercise.description || undefined,
      category: dbExercise.muscleGroups[0], // Using first muscle group as category
      difficulty: dbExercise.difficulty || "beginner",
      equipment: dbExercise.equipment?.join(", ") || undefined,
      link: dbExercise.link || undefined,
      muscles_targeted: dbExercise.muscleGroups,
      created_at: dbExercise.createdAt,
      updated_at: dbExercise.updatedAt,
    };
    return {
      success: true,
      exercise,
    };
  }

  /**
   * Create new exercise
   * @param requestBody Exercise data
   */
  @Post("/")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createExercise(
    @Body() requestBody: any
  ): Promise<ExerciseResponse> {
    const validatedData = insertExerciseSchema.parse(requestBody);
    const dbExercise = await exerciseService.createExercise(validatedData);
    const exercise: Exercise = {
      id: dbExercise.id,
      name: dbExercise.name,
      description: dbExercise.description || undefined,
      category: dbExercise.muscleGroups[0],
      difficulty: dbExercise.difficulty || "beginner",
      equipment: dbExercise.equipment?.join(", ") || undefined,
      link: dbExercise.link || undefined,
      muscles_targeted: dbExercise.muscleGroups,
      created_at: dbExercise.createdAt,
      updated_at: dbExercise.updatedAt,
    };
    return {
      success: true,
      exercise,
    };
  }

  /**
   * Update exercise
   * @param id Exercise ID
   * @param requestBody Updated exercise data
   */
  @Put("/{id}")
  @Response<ExerciseResponse>(400, "Bad Request")
  @Response<ApiResponse>(404, "Not Found")
  @SuccessResponse(200, "Success")
  public async updateExercise(
    @Path() id: number,
    @Body() requestBody: any
  ): Promise<ExerciseResponse> {
    const validatedData = insertExerciseSchema.parse(requestBody);
    const dbExercise = await exerciseService.updateExercise(id, validatedData);
    if (!dbExercise) {
      throw new Error("Exercise not found");
    }
    const exercise: Exercise = {
      id: dbExercise.id,
      name: dbExercise.name,
      description: dbExercise.description || undefined,
      category: dbExercise.muscleGroups[0],
      difficulty: dbExercise.difficulty || "beginner",
      equipment: dbExercise.equipment?.join(", ") || undefined,
      link: dbExercise.link || undefined,
      muscles_targeted: dbExercise.muscleGroups,
      created_at: dbExercise.createdAt,
      updated_at: dbExercise.updatedAt,
    };
    return {
      success: true,
      exercise,
    };
  }

  /**
   * Delete exercise
   * @param id Exercise ID
   */
  @Delete("/{id}")
  @Response<ApiResponse>(400, "Bad Request")
  @Response<ApiResponse>(404, "Not Found")
  @SuccessResponse(200, "Success")
  public async deleteExercise(@Path() id: number): Promise<ApiResponse> {
    await exerciseService.deleteExercise(id);
    return {
      success: true,
    };
  }

  /**
   * Update exercise link (YouTube video or image URL)
   * @param id Exercise ID
   * @param requestBody Link update data
   */
  @Put("/{id}/link")
  @Response<ApiResponse>(400, "Bad Request")
  @Response<ApiResponse>(404, "Exercise not found")
  @SuccessResponse(200, "Link updated successfully")
  @Example<ApiResponse>({
    success: true,
  })
  public async updateExerciseLink(
    @Path() id: number,
    @Body() requestBody: { link: string | null }
  ): Promise<ApiResponse> {
    const { link } = requestBody;

    // Validate link if provided
    if (link) {
      const isValidLink = validateExerciseLink(link);
      if (!isValidLink.isValid) {
        this.setStatus(400);
        return {
          success: false,
          error: isValidLink.error || "Invalid link format",
        };
      }
    }

    // Check if exercise exists
    const existingExercise = await exerciseService.getExerciseById(id);
    if (!existingExercise) {
      this.setStatus(404);
      return {
        success: false,
        error: "Exercise not found",
      };
    }

    // Update the exercise link
    await exerciseService.updateExerciseLink(id, link);

    return {
      success: true,
    };
  }
}

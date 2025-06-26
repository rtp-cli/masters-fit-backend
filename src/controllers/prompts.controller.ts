import { promptsService } from "@/services";
import {
  CreatePromptResponse,
  UserPromptsResponse,
  Prompt,
} from "@/types/prompts/responses";
import { CreatePromptRequest } from "@/types/prompts/requests";
import {
  Body,
  Controller,
  Get,
  Path,
  Route,
  Tags,
  Response,
  SuccessResponse,
  Post,
  Example,
  Security,
} from "@tsoa/runtime";

@Route("prompts")
@Tags("Prompts")
@Security("bearerAuth")
export class PromptsController extends Controller {
  /**
   * Get all prompts for a user
   * @param userId The ID of the user to get prompts for
   * @returns An array of prompts
   */
  @Get("/{userId}")
  @Response<UserPromptsResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getUserPrompts(
    @Path() userId: number
  ): Promise<UserPromptsResponse> {
    const dbPrompts = await promptsService.getUserPrompts(userId);
    const prompts: Prompt[] = dbPrompts.map((p) => ({
      id: p.id,
      userId: p.userId,
      prompt: p.prompt,
      response: p.response,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    }));
    return {
      success: true,
      prompts,
    };
  }

  /**
   * Create a new prompt
   * @param requestBody The prompt to create
   * @returns The created prompt
   */
  @Post("/")
  @Response<CreatePromptResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createPrompt(
    @Body() requestBody: CreatePromptRequest
  ): Promise<CreatePromptResponse> {
    const dbPrompt = await promptsService.createPrompt(requestBody);
    const prompt: Prompt = {
      id: dbPrompt.id,
      userId: dbPrompt.userId,
      prompt: dbPrompt.prompt,
      response: dbPrompt.response,
      created_at: dbPrompt.createdAt,
      updated_at: dbPrompt.updatedAt,
    };
    return {
      success: true,
      prompt,
    };
  }
}

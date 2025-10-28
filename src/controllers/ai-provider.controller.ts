import {
  Body,
  Controller,
  Get,
  Path,
  Put,
  Route,
  Tags,
  Security,
  Response,
} from "@tsoa/runtime";
import {
  ProviderAvailabilityResponse,
  UpdateProviderRequest,
  UserProviderResponse,
  AIProvider
} from "@/types/ai-provider/types";
import { ApiResponse } from "@/types/common/responses";
import { aiProviderService } from "@/services/ai-provider.service";
import { profileService } from "@/services/profile.service";
import { logger } from "@/utils/logger";

@Route("ai-providers")
@Tags("AI Providers")
@Security("bearerAuth")
export class AIProviderController extends Controller {
  /**
   * Get available AI providers and their models
   */
  @Get("available")
  @Response<ApiResponse>(400, "Bad Request")
  public async getAvailableProviders(): Promise<ProviderAvailabilityResponse> {
    try {
      const providerStatuses = aiProviderService.getProviderStatuses();

      const providers = {} as ProviderAvailabilityResponse['providers'];

      for (const [provider, status] of Object.entries(providerStatuses)) {
        providers[provider as AIProvider] = {
          available: status.available,
          displayName: status.displayName,
          models: status.models,
          defaultModel: status.defaultModel
        };
      }

      return {
        success: true,
        providers
      };
    } catch (error) {
      logger.error("Failed to get available providers", error as Error);
      throw new Error("Failed to retrieve available providers");
    }
  }

  /**
   * Update user's AI provider and model preference
   */
  @Put("user/{userId}/provider")
  @Response<ApiResponse>(404, "User not found")
  public async updateUserProvider(
    @Path() userId: number,
    @Body() request: UpdateProviderRequest
  ): Promise<{ success: boolean }> {
    try {
      // Get existing profile
      const existingProfile = await profileService.getProfileByUserId(userId);
      if (!existingProfile) {
        this.setStatus(404);
        throw new Error("User profile not found");
      }

      // Update profile with new AI provider and model
      await profileService.createOrUpdateProfile({
        ...existingProfile,
        aiProvider: request.provider,
        aiModel: request.model,
      });

      logger.info(`Updated AI provider for user ${userId}`, {
        userId,
        provider: request.provider,
        model: request.model,
        previousProvider: existingProfile.aiProvider,
        previousModel: existingProfile.aiModel
      });

      return { success: true };
    } catch (error) {
      logger.error(`Failed to update AI provider for user ${userId}`, error as Error);
      throw error;
    }
  }

  /**
   * Get user's current AI provider and model
   */
  @Get("user/{userId}/provider")
  @Response<ApiResponse>(400, "Bad Request")
  @Response<ApiResponse>(404, "User not found")
  public async getUserProvider(@Path() userId: number): Promise<UserProviderResponse> {
    try {
      const profile = await profileService.getProfileByUserId(userId);

      if (!profile) {
        this.setStatus(404);
        throw new Error("User profile not found");
      }

      // Profile guaranteed to have these values after migration
      const provider = profile.aiProvider!;
      const model = profile.aiModel!;

      return {
        success: true,
        provider,
        model
      };
    } catch (error) {
      logger.error(`Failed to get AI provider for user ${userId}`, error as Error);
      throw error;
    }
  }

}
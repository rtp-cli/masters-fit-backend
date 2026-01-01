import { InsertPrompt, Prompt, prompts } from "@/models";
import { BaseService } from "./base.service";
import { profileService } from "./profile.service";
import { eq, and, asc } from "drizzle-orm";
import { logger } from "@/utils/logger";
import { emitProgress } from "@/utils/websocket-progress.utils";
import { WorkoutAgentService } from "./workout-agent.service";
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_AI_MODEL,
} from "@/constants/ai-providers";
// Result type that includes token usage
export interface PromptGenerationResult {
  response: any;
  promptId: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// Token usage type for export
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Map to store last token usage per user (for retrieval after generation)
const lastTokenUsageByUser = new Map<number, TokenUsage>();

/**
 * Get the last recorded token usage for a user
 * This is populated after each generation/regeneration
 */
export function getLastTokenUsage(userId: number): TokenUsage | null {
  return lastTokenUsageByUser.get(userId) || null;
}

/**
 * Clear the last recorded token usage for a user
 */
export function clearLastTokenUsage(userId: number): void {
  lastTokenUsageByUser.delete(userId);
}

export class PromptsService extends BaseService {
  constructor() {
    super();
  }

  // Create user-specific workout agent based on their AI provider preferences
  private async createUserWorkoutAgent(
    userId: number
  ): Promise<WorkoutAgentService> {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Use user's AI provider preferences if available, otherwise fallback to defaults
    const provider = profile.aiProvider || DEFAULT_AI_PROVIDER;
    const model = profile.aiModel || DEFAULT_AI_MODEL;

    logger.info("Creating user-specific WorkoutAgentService", {
      userId,
      provider,
      model,
      operation: "createUserWorkoutAgent",
    });

    return WorkoutAgentService.createForUser({
      ...profile,
      aiProvider: provider,
      aiModel: model,
    });
  }

  public async getUserPrompts(userId: number): Promise<Prompt[]> {
    const result = await this.db
      .select()
      .from(prompts)
      .where(eq(prompts.userId, userId));
    return result;
  }

  public async createPrompt(prompt: InsertPrompt): Promise<Prompt> {
    const result = await this.db.insert(prompts).values(prompt).returning();
    return result[0];
  }

  public async generatePrompt(
    userId: number,
    customFeedback?: string,
    threadId?: string,
    signal?: AbortSignal
  ): Promise<PromptGenerationResult> {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Validate profile has required fields
    if (
      !profile.availableDays ||
      !profile.preferredStyles ||
      !profile.workoutDuration ||
      !profile.environment
    ) {
      throw new Error(
        "Profile is missing required fields: availableDays, preferredStyles, workoutDuration, or environment"
      );
    }

    // Create user-specific workout agent
    const workoutAgent = await this.createUserWorkoutAgent(userId);

    // Generate a thread ID if not provided to enable conversation memory for all users
    const workoutThreadId = threadId || `workout_${userId}_${Date.now()}`;

    try {
      const result = await workoutAgent.regenerateWorkout(
        userId,
        profile,
        [], // exerciseNames no longer needed - agent uses tools
        workoutThreadId,
        customFeedback || "Generate weekly workout plan",
        undefined, // dayNumber
        false, // isRestDay
        signal // Pass abort signal through
      );

      const createdPrompt = await this.createPrompt({
        userId,
        prompt: customFeedback || "Generate weekly workout plan",
        response: JSON.stringify(result.workout),
        threadId: workoutThreadId,
      });

      // Store token usage for retrieval
      lastTokenUsageByUser.set(userId, result.tokenUsage);

      logger.info("Prompt generation completed with token usage", {
        userId,
        promptId: createdPrompt.id,
        tokenUsage: result.tokenUsage,
        operation: "generatePrompt",
      });

      return {
        response: result.workout,
        promptId: createdPrompt.id,
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      logger.error("LangChain workout generation failed", error as Error, {
        error: (error as Error).message,
        userId,
        threadId: workoutThreadId,
        operation: "generatePrompt",
      });
      throw new Error(
        `Failed to generate workout plan: ${(error as Error).message}`
      );
    }
  }

  public async generateChunkedPrompt(
    userId: number,
    customFeedback?: string,
    signal?: AbortSignal
  ): Promise<PromptGenerationResult> {
    // For now, chunked generation will simply call the regular generatePrompt method
    // since LangChain agents can handle the full workout generation more efficiently
    // If token limits become an issue, we can implement chunking within the agent

    logger.info("Chunked generation requested, using LangChain agent instead", {
      userId,
      operation: "generateChunkedPrompt",
    });

    // Emit progress to match expected behavior
    emitProgress(userId, 12);
    emitProgress(userId, 15);
    emitProgress(userId, 50);
    emitProgress(userId, 90);

    try {
      const result = await this.generatePrompt(
        userId,
        customFeedback,
        undefined,
        signal
      );

      // Emit final progress
      emitProgress(userId, 95);
      emitProgress(userId, 99);

      return result;
    } catch (error) {
      logger.error("Chunked generation failed", error as Error, {
        userId,
        operation: "generateChunkedPrompt",
      });
      throw error;
    }
  }

  public async generateRegenerationPrompt(
    userId: number,
    regenerationData: {
      goals?: string[];
      limitations?: string[];
      fitnessLevel?: string;
      environment?: string;
      equipment?: string[];
      preferredStyles?: string[];
      availableDays?: string[];
      workoutDuration?: number;
      intensityLevel?: string;
      customFeedback?: string;
    },
    signal?: AbortSignal
  ): Promise<PromptGenerationResult> {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Create user-specific workout agent
    const workoutAgent = await this.createUserWorkoutAgent(userId);

    // Merge current profile with regeneration data
    const updatedProfile = {
      ...profile,
      goals: regenerationData.goals || profile.goals,
      limitations: regenerationData.limitations || profile.limitations,
      fitnessLevel: regenerationData.fitnessLevel || profile.fitnessLevel,
      environment: regenerationData.environment || profile.environment,
      equipment: regenerationData.equipment || profile.equipment,
      otherEquipment:
        (regenerationData as any).otherEquipment || profile.otherEquipment,
      preferredStyles:
        regenerationData.preferredStyles || profile.preferredStyles,
      availableDays: regenerationData.availableDays || profile.availableDays,
      workoutDuration:
        regenerationData.workoutDuration || profile.workoutDuration,
      intensityLevel: regenerationData.intensityLevel || profile.intensityLevel,
    } as any;

    // Generate a thread ID for conversation memory
    const workoutThreadId = `workout_regen_${userId}_${Date.now()}`;

    try {
      const result = await workoutAgent.regenerateWorkout(
        userId,
        updatedProfile,
        [], // exerciseNames no longer needed - agent uses tools
        workoutThreadId,
        regenerationData.customFeedback ||
          "Regenerate weekly workout plan with updated preferences",
        undefined, // dayNumber
        false, // isRestDay
        signal // Pass abort signal through
      );

      const createdPrompt = await this.createPrompt({
        userId,
        prompt:
          regenerationData.customFeedback || "Regenerate weekly workout plan",
        response: JSON.stringify(result.workout),
        threadId: workoutThreadId,
      });

      // Store token usage for retrieval
      lastTokenUsageByUser.set(userId, result.tokenUsage);

      logger.info("Regeneration prompt completed with token usage", {
        userId,
        promptId: createdPrompt.id,
        tokenUsage: result.tokenUsage,
        operation: "generateRegenerationPrompt",
      });

      return {
        response: result.workout,
        promptId: createdPrompt.id,
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      logger.error("LangChain workout regeneration failed", error as Error, {
        error: (error as Error).message,
        userId,
        threadId: workoutThreadId,
        operation: "generateRegenerationPrompt",
      });
      throw new Error(
        `Failed to regenerate workout plan: ${(error as Error).message}`
      );
    }
  }

  public async generateDailyRegenerationPrompt(
    userId: number,
    dayNumber: number,
    _previousWorkout: any, // Unused in LangChain implementation but kept for API compatibility
    regenerationReason: string,
    isRestDay: boolean = false,
    threadId?: string,
    signal?: AbortSignal
  ): Promise<PromptGenerationResult> {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Create user-specific workout agent
    const workoutAgent = await this.createUserWorkoutAgent(userId);

    // Generate a thread ID if not provided to enable conversation memory for all users
    const workoutThreadId = threadId || `workout_daily_${userId}_${Date.now()}`;

    try {
      const result = await workoutAgent.regenerateWorkout(
        userId,
        profile,
        [], // exerciseNames no longer needed - agent uses tools
        workoutThreadId,
        regenerationReason,
        dayNumber,
        isRestDay,
        signal // Pass abort signal through
      );

      const createdPrompt = await this.createPrompt({
        userId,
        prompt: regenerationReason,
        response: JSON.stringify(result.workout),
        threadId: workoutThreadId,
      });

      // Emit 95% - AI response received and parsed
      emitProgress(userId, 95);

      // Store token usage for retrieval
      lastTokenUsageByUser.set(userId, result.tokenUsage);

      logger.info("Daily regeneration prompt completed with token usage", {
        userId,
        promptId: createdPrompt.id,
        dayNumber,
        tokenUsage: result.tokenUsage,
        operation: "generateDailyRegenerationPrompt",
      });

      return {
        response: result.workout,
        promptId: createdPrompt.id,
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      logger.error("LangChain daily regeneration failed", error as Error, {
        error: (error as Error).message,
        userId,
        threadId: workoutThreadId,
        dayNumber,
        operation: "generateDailyRegenerationPrompt",
      });
      throw new Error(
        `Failed to regenerate daily workout: ${(error as Error).message}`
      );
    }
  }
}

export const promptsService = new PromptsService();

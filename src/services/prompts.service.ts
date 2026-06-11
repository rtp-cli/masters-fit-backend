import { InsertPrompt, Prompt, prompts } from "@/models";
import { BaseService } from "./base.service";
import { profileService } from "./profile.service";
import { eq, and, asc } from "drizzle-orm";
import { logger } from "@/utils/logger";
import {
  emitProgress,
  emitGenerationStatus,
  GenerationDayStatus,
} from "@/utils/websocket-progress.utils";
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

  /**
   * Fan-out weekly generation: planning call + parallel per-day calls with
   * structured outputs, emitting real per-day progress over the websocket.
   * Callers fall back to generatePrompt (single whole-week call) on failure.
   */
  public async generateChunkedPrompt(
    userId: number,
    customFeedback?: string,
    signal?: AbortSignal
  ): Promise<PromptGenerationResult> {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }
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

    const workoutAgent = await this.createUserWorkoutAgent(userId);

    emitGenerationStatus(userId, { progress: 15, phase: "planning" });

    let dayStatuses: GenerationDayStatus[] = [];
    const dayProgress = () => {
      const done = dayStatuses.filter((d) => d.status === "done").length;
      const total = dayStatuses.length || 1;
      // 25% = plan ready, 95% = all days generated; saving happens after
      return Math.round(25 + 70 * (done / total));
    };

    try {
      const result = await workoutAgent.generateWeeklyWorkout(
        userId,
        profile,
        customFeedback || "Generate weekly workout plan",
        {
          signal,
          onProgress: (update) => {
            if (update.type === "plan_ready") {
              dayStatuses = update.days.map((d) => ({
                dayNumber: d.dayNumber,
                label: d.label,
                status: "generating" as const,
              }));
              emitGenerationStatus(userId, {
                progress: 25,
                phase: "generating_days",
                days: dayStatuses,
              });
              return;
            }
            const day = dayStatuses.find(
              (d) => d.dayNumber === update.dayNumber
            );
            if (day) {
              day.status = update.type === "day_done" ? "done" : "failed";
            }
            emitGenerationStatus(userId, {
              progress: dayProgress(),
              phase: "generating_days",
              days: dayStatuses,
            });
          },
        }
      );

      emitGenerationStatus(userId, {
        progress: 95,
        phase: "saving",
        days: dayStatuses,
      });

      const createdPrompt = await this.createPrompt({
        userId,
        prompt: customFeedback || "Generate weekly workout plan",
        response: JSON.stringify(result.workout),
        threadId: `workout_fanout_${userId}_${Date.now()}`,
      });

      lastTokenUsageByUser.set(userId, result.tokenUsage);

      logger.info("Fan-out generation completed with token usage", {
        userId,
        promptId: createdPrompt.id,
        tokenUsage: result.tokenUsage,
        operation: "generateChunkedPrompt",
      });

      return {
        response: result.workout,
        promptId: createdPrompt.id,
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      logger.error("Fan-out generation failed", error as Error, {
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

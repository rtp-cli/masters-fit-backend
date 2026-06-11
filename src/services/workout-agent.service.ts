import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  type UsageMetadata,
} from "@langchain/core/messages";
import { Profile } from "@/models";
import { logger } from "@/utils/logger";
import { exerciseService, ExerciseMetadata } from "./exercise.service";
import {
  buildClaudePrompt,
  buildClaudeDailyPrompt,
} from "@/utils/prompt-generator";
import {
  buildFanoutSystemPrompt,
  buildPlanningUserMessage,
  buildDayUserMessage,
  WEEK_PLAN_SCHEMA,
  WORKOUT_DAY_SCHEMA,
  WeekPlan,
} from "@/utils/fanout-prompt-generator";
import { aiProviderService } from "./ai-provider.service";
import { AIProvider } from "@/constants/ai-providers";

// Result type that includes token usage
export interface WorkoutGenerationResult {
  workout: any;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// Progress callbacks emitted by fan-out weekly generation
export type WeeklyGenerationProgress =
  | { type: "plan_ready"; days: { dayNumber: number; label: string }[] }
  | { type: "day_done"; dayNumber: number }
  | { type: "day_failed"; dayNumber: number };

const EXERCISE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const exerciseCache = new Map<string, { exercises: ExerciseMetadata[]; expiresAt: number }>();

export class WorkoutAgentService {
  private llm: BaseChatModel;
  private currentProvider: AIProvider;
  private currentModel: string;
  private messageHistories: Map<string, InMemoryChatMessageHistory> = new Map();
  private activeGenerations: Map<string, AbortController> = new Map();

  constructor(provider: AIProvider, model: string) {
    this.currentProvider = provider;
    this.currentModel = model;
    this.llm = aiProviderService.createLLMInstance(provider, model);

    logger.info("WorkoutAgentService initialized", {
      provider: this.currentProvider,
      model: this.currentModel,
    });
  }

  public getCurrentProvider(): AIProvider {
    return this.currentProvider;
  }

  public getCurrentModel(): string {
    return this.currentModel;
  }

  // Create instance with user's preferred provider/model
  public static createForUser(profile: Profile): WorkoutAgentService {
    return new WorkoutAgentService(profile.aiProvider!, profile.aiModel!);
  }

  private exerciseCacheKey(profile: Profile): string {
    const equipment = Array.isArray(profile.equipment)
      ? [...profile.equipment].sort().join(",")
      : profile.equipment || "";
    return `${profile.environment}:${equipment}`;
  }

  private async getFilteredExercises(
    profile: Profile
  ): Promise<ExerciseMetadata[]> {
    const cacheKey = this.exerciseCacheKey(profile);
    const cached = exerciseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.exercises;
    }

    try {
      const filters: any = { limit: 200 };

      if (profile.environment === "bodyweight_only") {
        filters.equipment = ["bodyweight"];
      } else if (profile.environment === "home_gym" && profile.equipment) {
        filters.equipment = Array.isArray(profile.equipment)
          ? profile.equipment
          : [profile.equipment];
      }

      const exercises = await exerciseService.searchExercises(filters);
      exerciseCache.set(cacheKey, { exercises, expiresAt: Date.now() + EXERCISE_CACHE_TTL_MS });

      logger.info("Exercise search completed", {
        cacheKey,
        resultCount: exercises.length,
      });

      return exercises;
    } catch (error) {
      logger.error("Failed to get filtered exercises", error as Error, {
        operation: "getFilteredExercises",
        metadata: { environment: profile.environment },
      });
      throw error;
    }
  }

  private formatExerciseContext(exercises: ExerciseMetadata[]): string {
    if (exercises.length === 0) {
      return "No exercises available for the specified constraints.";
    }

    // Group exercises by muscle groups for better organization
    const exercisesByMuscleGroup: Record<string, ExerciseMetadata[]> = {};

    exercises.forEach((exercise) => {
      exercise.muscleGroups.forEach((muscleGroup) => {
        if (!exercisesByMuscleGroup[muscleGroup]) {
          exercisesByMuscleGroup[muscleGroup] = [];
        }
        if (
          !exercisesByMuscleGroup[muscleGroup].some(
            (e) => e.name === exercise.name
          )
        ) {
          exercisesByMuscleGroup[muscleGroup].push(exercise);
        }
      });
    });

    let context = "";
    Object.entries(exercisesByMuscleGroup).forEach(
      ([muscleGroup, groupExercises]) => {
        context += `\n### ${muscleGroup.toUpperCase()} EXERCISES:\n`;
        groupExercises.forEach((exercise) => {
          const equipmentList =
            exercise.equipment && exercise.equipment.length > 0
              ? exercise.equipment.join(", ")
              : "bodyweight";
          const difficulty = exercise.difficulty || "moderate";

          context += `- **${exercise.name}** (equipment: ${equipmentList}, difficulty: ${difficulty})\n`;
        });
      }
    );

    return context;
  }

  private async buildSystemMessage(
    profile: Profile,
    context: "weekly" | "daily" = "daily",
    regenerationReason?: string,
    dayNumber?: number,
    isRestDay: boolean = false
  ): Promise<SystemMessage> {
    // Use the comprehensive prompts from prompt-generator.ts
    let systemContent: string;

    if (context === "daily" && dayNumber !== undefined) {
      // Use daily prompt for daily regeneration
      systemContent = buildClaudeDailyPrompt(
        profile,
        [], // exerciseNames - will be replaced with filtered exercise context
        dayNumber,
        null, // previousWorkout - not needed for LangChain
        regenerationReason || "Generate daily workout",
        isRestDay
      );
    } else {
      // Use weekly/general prompt
      systemContent = buildClaudePrompt(
        profile,
        [], // exerciseNames - will be replaced with filtered exercise context
        regenerationReason
      );
    }

    // Pre-load filtered exercises based on user constraints
    const availableExercises = await this.getFilteredExercises(profile);
    const exerciseContext = this.formatExerciseContext(availableExercises);

    // Add exercise context to the comprehensive prompt
    const enhancedSystemContent = `${systemContent}

## AVAILABLE EXERCISES FOR YOUR WORKOUTS

You have access to the following exercises that match the user's equipment and environment constraints. Use ONLY these exercises in your workout design:

${exerciseContext}

## EXERCISE SELECTION INSTRUCTIONS

1. **Use EXACT exercise names** from the list above
2. **Respect equipment constraints** - all listed exercises are pre-filtered for user's equipment
3. **Consider muscle groups and difficulty** when selecting exercises
4. **Choose appropriate variations** - multiple variations of exercises are available
5. **Follow workout style requirements** - some exercises may be tagged for specific styles

## CRITICAL REMINDER: VALID JSON OUTPUT ONLY

Your final response MUST be a valid JSON workout plan following the exact structure specified in the prompt above.
No explanations or text outside the JSON structure in your final response.`;

    // Mark the system message for Anthropic prompt caching. The large static
    // prompt (rules + exercise list) is cached for 5 minutes, cutting LLM
    // processing time by ~60% on repeat generations.
    return new SystemMessage({
      content: [
        {
          type: "text",
          text: enhancedSystemContent,
          cache_control: { type: "ephemeral" },
        } as any,
      ],
    });
  }

  private buildUserMessage(
    profile: Profile,
    regenerationReason?: string,
    dayNumber?: number,
    isRestDay: boolean = false
  ): HumanMessage {
    // Simple user message since the comprehensive prompts are now in the system message
    let userContent =
      "Please generate the workout now using the comprehensive system instructions.";

    // Add any specific regeneration context if provided
    if (
      regenerationReason &&
      regenerationReason !== "Generate weekly workout plan" &&
      regenerationReason !== "Generate daily workout"
    ) {
      userContent = `SPECIFIC USER FEEDBACK: "${regenerationReason}"

Please generate the workout now, addressing this feedback while following all system instructions.`;
    }

    return new HumanMessage(userContent);
  }

  async regenerateWorkout(
    userId: number,
    profile: Profile,
    _exerciseNames: string[], // Unused in LangChain implementation but kept for API compatibility
    threadId: string,
    regenerationReason: string,
    dayNumber?: number,
    isRestDay: boolean = false,
    signal?: AbortSignal
  ): Promise<WorkoutGenerationResult> {
    try {
      // Create and store AbortController for this generation
      const abortController = new AbortController();
      const generationKey = `${userId}_${threadId}_${Date.now()}`;
      this.activeGenerations.set(generationKey, abortController);

      // If external signal is provided, forward the abort
      if (signal) {
        signal.addEventListener("abort", () => {
          abortController.abort();
          this.activeGenerations.delete(generationKey);
        });
      }

      // Check if already aborted
      if (signal?.aborted) {
        this.activeGenerations.delete(generationKey);
        throw new Error("Generation was cancelled");
      }

      // Get or create message history for this thread
      if (!this.messageHistories.has(threadId)) {
        this.messageHistories.set(threadId, new InMemoryChatMessageHistory());
      }

      const messageHistory = this.messageHistories.get(threadId)!;

      // Build messages (no longer need exerciseNames)
      const systemMessage = await this.buildSystemMessage(
        profile,
        dayNumber ? "daily" : "weekly",
        regenerationReason,
        dayNumber,
        isRestDay
      );
      const userMessage = this.buildUserMessage(
        profile,
        regenerationReason,
        dayNumber,
        isRestDay
      );

      // Get existing messages from history
      const existingMessages = await messageHistory.getMessages();

      // Combine all messages for single LLM call
      const messages = [systemMessage, ...existingMessages, userMessage];

      // Single LLM call with comprehensive context and abort signal
      const llmStartedAt = Date.now();
      const response = await this.llm.invoke(messages, {
        signal: abortController.signal,
      });
      const llmDurationMs = Date.now() - llmStartedAt;

      // Extract token usage from the response
      const usageMetadata = (response as AIMessage).usage_metadata;
      const tokenUsage = {
        inputTokens: usageMetadata?.input_tokens || 0,
        outputTokens: usageMetadata?.output_tokens || 0,
        totalTokens: usageMetadata?.total_tokens || 0,
      };

      logger.info("LLM response received with token usage", {
        userId,
        threadId,
        tokenUsage,
        llmDurationMs,
        provider: this.currentProvider,
        model: this.currentModel,
        // Anthropic prompt-cache effectiveness: cache_read > 0 means the
        // system prefix was served from cache instead of reprocessed.
        cacheReadInputTokens: usageMetadata?.input_token_details?.cache_read ?? 0,
        cacheCreationInputTokens:
          usageMetadata?.input_token_details?.cache_creation ?? 0,
        operation: "regenerateWorkout",
      });

      // Add the exchange to history
      await messageHistory.addMessage(userMessage);
      await messageHistory.addMessage(response);

      // Clean up the active generation
      this.activeGenerations.delete(generationKey);

      // Parse and return the workout with token usage
      const cleanedResponse = this.cleanJsonResponse(
        response.content as string
      );
      return {
        workout: JSON.parse(cleanedResponse),
        tokenUsage,
      };
    } catch (error) {
      // Clean up on any error
      const generationKey = `${userId}_${threadId}`;
      this.activeGenerations.forEach((controller, key) => {
        if (key.startsWith(generationKey)) {
          this.activeGenerations.delete(key);
        }
      });

      logger.error("Workout agent generation failed", error as Error, {
        userId,
        threadId,
        operation: "regenerateWorkout",
      });
      throw error;
    }
  }

  /**
   * Fan-out weekly generation: one small planning call designs the week
   * split, then all days generate in parallel with structured outputs.
   * Wall-clock ≈ planning + slowest single day instead of the whole week
   * generating serially in one call.
   */
  async generateWeeklyWorkout(
    userId: number,
    profile: Profile,
    customFeedback?: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (update: WeeklyGenerationProgress) => void;
    }
  ): Promise<WorkoutGenerationResult> {
    const { signal, onProgress } = options || {};
    const startedAt = Date.now();

    // Shared, profile-stable system prompt (rules + exercise list). Marked
    // for prompt caching so the planning call warms the cache and the
    // parallel day calls (plus repeat generations within 5 min) read it.
    const availableExercises = await this.getFilteredExercises(profile);
    const exerciseContext = this.formatExerciseContext(availableExercises);
    const systemMessage = new SystemMessage({
      content: [
        {
          type: "text",
          text: `${buildFanoutSystemPrompt(profile)}

## AVAILABLE EXERCISES FOR YOUR WORKOUTS

These exercises match the user's equipment and environment constraints:
${exerciseContext}`,
          cache_control: { type: "ephemeral" },
        } as any,
      ],
    });

    const usageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    const recordUsage = (raw: any) => {
      const usage = (raw as AIMessage)?.usage_metadata;
      usageTotals.inputTokens += usage?.input_tokens || 0;
      usageTotals.outputTokens += usage?.output_tokens || 0;
      usageTotals.totalTokens += usage?.total_tokens || 0;
      cacheReadTokens += usage?.input_token_details?.cache_read || 0;
      cacheCreationTokens += usage?.input_token_details?.cache_creation || 0;
    };

    // 1. Planning call — small output (~300 tokens), also warms the cache
    const planLlm = this.llm.withStructuredOutput(WEEK_PLAN_SCHEMA as any, {
      name: "week_plan",
      includeRaw: true,
    });
    const planResult: any = await planLlm.invoke(
      [systemMessage, new HumanMessage(buildPlanningUserMessage(profile, customFeedback))],
      { signal }
    );
    recordUsage(planResult.raw);
    const weekPlan = planResult.parsed as WeekPlan;
    if (!weekPlan?.days?.length) {
      throw new Error("Week planning returned no days");
    }

    logger.info("Week plan ready", {
      userId,
      planName: weekPlan.name,
      dayCount: weekPlan.days.length,
      planningDurationMs: Date.now() - startedAt,
      operation: "generateWeeklyWorkout",
    });
    onProgress?.({
      type: "plan_ready",
      days: weekPlan.days.map((d) => ({ dayNumber: d.day, label: d.name })),
    });

    // 2. Day calls — parallel, one retry each on failure
    const dayLlm = this.llm.withStructuredOutput(WORKOUT_DAY_SCHEMA as any, {
      name: "workout_day",
      includeRaw: true,
    });
    const generateDay = async (day: WeekPlan["days"][number]) => {
      const invokeOnce = async () => {
        const res: any = await dayLlm.invoke(
          [
            systemMessage,
            new HumanMessage(buildDayUserMessage(profile, weekPlan, day, customFeedback)),
          ],
          { signal }
        );
        recordUsage(res.raw);
        if (!res.parsed?.blocks?.length) {
          throw new Error(`Day ${day.day} generation returned no blocks`);
        }
        return res.parsed;
      };

      try {
        const result = await invokeOnce();
        onProgress?.({ type: "day_done", dayNumber: day.day });
        return result;
      } catch (firstError) {
        if (signal?.aborted) throw firstError;
        logger.warn("Day generation failed, retrying once", {
          userId,
          dayNumber: day.day,
          error: (firstError as Error).message,
          operation: "generateWeeklyWorkout",
        });
        try {
          const result = await invokeOnce();
          onProgress?.({ type: "day_done", dayNumber: day.day });
          return result;
        } catch (retryError) {
          onProgress?.({ type: "day_failed", dayNumber: day.day });
          throw retryError;
        }
      }
    };

    const generatedDays = await Promise.all(weekPlan.days.map(generateDay));

    // 3. Assemble the legacy single-call response shape
    const exercisesToAdd: any[] = [];
    const seenNewExercises = new Set<string>();
    const workoutPlan = generatedDays
      .sort((a, b) => a.day - b.day)
      .map((generatedDay) => {
        const { exercisesToAdd: dayExercises, ...dayPlan } = generatedDay;
        for (const exercise of dayExercises || []) {
          const key = exercise.name?.toLowerCase();
          if (key && !seenNewExercises.has(key)) {
            seenNewExercises.add(key);
            exercisesToAdd.push(exercise);
          }
        }
        return dayPlan;
      });

    logger.info("Fan-out weekly generation complete", {
      userId,
      dayCount: workoutPlan.length,
      newExerciseCount: exercisesToAdd.length,
      totalDurationMs: Date.now() - startedAt,
      tokenUsage: usageTotals,
      cacheReadTokens,
      cacheCreationTokens,
      operation: "generateWeeklyWorkout",
    });

    return {
      workout: {
        name: weekPlan.name,
        description: weekPlan.description,
        workoutPlan,
        exercisesToAdd,
      },
      tokenUsage: usageTotals,
    };
  }

  private cleanJsonResponse(response: string): string {
    const jsonBlockPattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
    const match = response.trim().match(jsonBlockPattern);
    return match ? match[1].trim() : response.trim();
  }

  clearThread(threadId: string) {
    this.messageHistories.delete(threadId);
    logger.info("Cleared conversation thread", { threadId });
  }

  // Cancel active generation for a specific user
  cancelUserGeneration(userId: number): boolean {
    let cancelled = false;
    this.activeGenerations.forEach((controller, key) => {
      if (key.startsWith(`${userId}_`)) {
        controller.abort();
        this.activeGenerations.delete(key);
        cancelled = true;
        logger.info("Cancelled active generation", {
          userId,
          generationKey: key,
        });
      }
    });
    return cancelled;
  }

  // Cancel all active generations (for shutdown/cleanup)
  cancelAllGenerations(): void {
    this.activeGenerations.forEach((controller, key) => {
      controller.abort();
      logger.info("Cancelled generation during cleanup", {
        generationKey: key,
      });
    });
    this.activeGenerations.clear();
  }

  // Get active generation count for monitoring
  getActiveGenerationCount(): number {
    return this.activeGenerations.size;
  }

  // Get thread message count for debugging
  async getThreadMessageCount(threadId: string): Promise<number> {
    const history = this.messageHistories.get(threadId);
    if (history) {
      const messages = await history.getMessages();
      return messages.length;
    }
    return 0;
  }
}

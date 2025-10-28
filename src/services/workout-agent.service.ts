import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { Profile } from "@/models";
import { logger } from "@/utils/logger";
import { exerciseService, ExerciseMetadata } from "./exercise.service";
import {
  buildClaudePrompt,
  buildClaudeDailyPrompt,
  getEquipmentDescription,
} from "@/utils/prompt-generator";
import { aiProviderService } from "./ai-provider.service";
import { AIProvider } from "@/constants/ai-providers";

export class WorkoutAgentService {
  private llm: BaseChatModel;
  private currentProvider: AIProvider;
  private currentModel: string;
  private messageHistories: Map<string, ChatMessageHistory> = new Map();
  private activeGenerations: Map<string, AbortController> = new Map();

  constructor(provider: AIProvider, model: string) {
    this.currentProvider = provider;
    this.currentModel = model;
    this.llm = aiProviderService.createLLMInstance(provider, model);

    logger.info('WorkoutAgentService initialized', {
      provider: this.currentProvider,
      model: this.currentModel
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

  private async getFilteredExercises(
    profile: Profile
  ): Promise<ExerciseMetadata[]> {
    try {
      const filters: any = { limit: 200 }; // Increase limit for comprehensive context

      logger.info("DEBUG: Starting exercise filtering", {
        operation: "getFilteredExercises",
        metadata: {
          environment: profile.environment,
          equipment: profile.equipment,
          profileData: {
            environment: profile.environment,
            equipment: profile.equipment,
            otherEquipment: profile.otherEquipment,
          },
        },
      });

      // Apply equipment constraints based on user environment
      if (profile.environment === "bodyweight_only") {
        filters.equipment = ["bodyweight"]; // Filter for bodyweight exercises
        logger.info("DEBUG: Applied bodyweight filter", { filters });
      } else if (profile.environment === "home_gym" && profile.equipment) {
        filters.equipment = Array.isArray(profile.equipment)
          ? profile.equipment
          : [profile.equipment];
        logger.info("DEBUG: Applied home gym filter", { filters });
      } else {
        logger.info(
          "DEBUG: No equipment filter applied (commercial gym or no equipment)",
          {
            environment: profile.environment,
            hasEquipment: !!profile.equipment,
          }
        );
      }

      logger.info("DEBUG: About to call exerciseService.searchExercises", {
        filters,
      });
      const exercises = await exerciseService.searchExercises(filters);
      logger.info("DEBUG: Exercise search completed", {
        filters,
        resultCount: exercises.length,
        firstFewExercises: exercises
          .slice(0, 3)
          .map((e) => ({ name: e.name, equipment: e.equipment })),
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

    return new SystemMessage(enhancedSystemContent);
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
  ): Promise<any> {
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
        this.messageHistories.set(threadId, new ChatMessageHistory());
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

      logger.info("Calling LLM with exercise context for workout generation", {
        userId,
        threadId,
        messageCount: existingMessages.length,
        operation: "regenerateWorkout",
      });

      // Combine all messages for single LLM call
      const messages = [systemMessage, ...existingMessages, userMessage];

      // Single LLM call with comprehensive context and abort signal
      const response = await this.llm.invoke(messages, {
        signal: abortController.signal,
      });

      // Add the exchange to history
      await messageHistory.addMessage(userMessage);
      await messageHistory.addMessage(response);

      // Clean up the active generation
      this.activeGenerations.delete(generationKey);

      // Parse and return the workout
      const cleanedResponse = this.cleanJsonResponse(
        response.content as string
      );
      return JSON.parse(cleanedResponse);
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

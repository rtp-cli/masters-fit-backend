import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  type UsageMetadata,
} from "@langchain/core/messages";
import { Profile } from "@/models";
import {
  describeCautions,
  describeContraindications,
  filterExercisesByLimitations,
} from "@/utils/limitation-validation";
import type { PhysicalLimitation } from "@/types";
import {
  checkConsecutiveMuscleGroupOverload,
  reorderToMinimizeConsecutiveOverload,
} from "@/utils/workout-balance-validation";
import { applyPostGenerationValidation } from "@/utils/post-generation-validation";
import { buildProgressionContext } from "@/utils/progression-context";
import { workoutService } from "./workout.service";
import { logger } from "@/utils/logger";
import {
  exerciseService,
  ExerciseMetadata,
  stratifyCatalog,
} from "./exercise.service";
import { exerciseExclusionService } from "./exercise-exclusion.service";
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
  PromptFeedback,
} from "@/utils/fanout-prompt-generator";
import {
  buildPlanDaySchedule,
  PlanDaySlot,
  mentionsWeekday,
  mentionsScheduleChange,
  resolveEffectiveSchedule,
  computeAdjacentDayPairs,
} from "@/utils/plan-schedule";
import {
  getCurrentDateString,
  getCurrentDateStringInTimezone,
} from "@/utils/date.utils";
import { aiProviderService } from "./ai-provider.service";
import { AIProvider } from "@/constants/ai-providers";
import { llmGenerationLogsService } from "./llm-generation-logs.service";
import { runWithAbortTimeout } from "@/utils/timeout.utils";
import { Semaphore } from "@/utils/concurrency.utils";
import {
  validateDailyGenerationResponse,
  validateWeeklyGenerationResponse,
} from "@/utils/generation-response-validation";

// Hard per-call ceilings for the fan-out LLM calls. Without these a stalled
// provider connection (one that never sends an RST) hangs the await forever,
// which leaves the Bull job `active` indefinitely and the client stuck on a
// spinner until its own multi-minute timeout fires. A timed-out day call
// simply rejects, so the existing retry loop re-attempts it and — if it still
// fails — the job fails fast with a real error instead of hanging.
const PLANNING_CALL_TIMEOUT_MS = 60_000;
const DAY_CALL_TIMEOUT_MS = 75_000;

// Models pinned for the Anthropic fan-out path (see the planning/day call
// sites below for why Haiku is the default). Overridable via env so an eval
// harness can sweep models without editing code.
const FANOUT_PLANNING_MODEL =
  process.env.FANOUT_PLANNING_MODEL || "claude-haiku-4-5-20251001";
const FANOUT_DAY_MODEL =
  process.env.FANOUT_DAY_MODEL || "claude-haiku-4-5-20251001";

// Size of the exercise menu shown to the LLM — same count as the old
// LIMIT 200, but now a deterministic stratified selection.
const GENERATION_CATALOG_SIZE = 200;

// The daily prompt demands "workoutDuration ±5 minutes"; the budget check
// uses the same tolerance so the model is only re-asked when it broke the
// rule it was already given.
const DURATION_TOLERANCE_MINUTES = 5;

// Total scheduled minutes of a generated day: the sum of its blocks'
// blockDurationMinutes (the same definition the prompt instructs the model
// to use for the session total).
function sumBlockMinutes(workout: any): number {
  const blocks = Array.isArray(workout?.blocks) ? workout.blocks : [];
  return blocks.reduce(
    (total: number, block: any) =>
      total + (Number(block?.blockDurationMinutes) || 0),
    0
  );
}

// Result type that includes token usage
export interface WorkoutGenerationResult {
  workout: any;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  // [GQ-01] The day-number -> {weekday, date} schedule the prompts were built
  // against. Returned so the persistence layer stamps the exact same dates the
  // model saw (single source of truth). Present only on the fan-out path.
  schedule?: PlanDaySlot[];
}

// Progress callbacks emitted by fan-out weekly generation
export type WeeklyGenerationProgress =
  | { type: "plan_ready"; days: { dayNumber: number; label: string }[] }
  | { type: "day_started"; dayNumber: number }
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
    // [LR-013] Limitations now affect which exercises this returns (see
    // filterExercisesByLimitations below) — must be part of the cache key,
    // or one user's cached unfiltered list could leak to a different user
    // with the same equipment/environment but different limitations.
    const limitations = Array.isArray(profile.limitations)
      ? [...profile.limitations].sort().join(",")
      : "";
    // Preferred styles rank exercises within stratifyCatalog's buckets, so
    // two users differing only in styles get different menus — key on them.
    const styles = Array.isArray(profile.preferredStyles)
      ? [...profile.preferredStyles].sort().join(",")
      : "";
    return `${profile.environment}:${equipment}:${limitations}:${styles}`;
  }

  private async getFilteredExercises(
    profile: Profile
  ): Promise<ExerciseMetadata[]> {
    // [GQ-16] The shared catalog is cached WITHOUT a userId (the cache key is
    // environment:equipment:limitations:styles), so per-user exercise
    // exclusions can't live in it. Fetch the shared catalog, then post-filter
    // this user's exclusions — preserving cache reuse across users while
    // finally honoring exclusions in generation (they were previously applied
    // only in the in-app search/replace path, never in weekly OR daily gen).
    const shared = await this.getSharedGenerationCatalog(profile);
    return this.applyUserExclusions(shared, profile);
  }

  // [GQ-16] Per-user exclusion post-filter. Matches on NAME because the cached
  // catalog items carry name but no id. Failure-safe: never block generation.
  private async applyUserExclusions(
    catalog: ExerciseMetadata[],
    profile: Profile
  ): Promise<ExerciseMetadata[]> {
    const userId = profile.userId;
    if (!userId) return catalog;
    try {
      const exclusions = await exerciseExclusionService.listExclusions(userId);
      if (exclusions.length === 0) return catalog;
      const excludedNames = new Set(
        exclusions.map((e) => e.name.trim().toLowerCase())
      );
      const filtered = catalog.filter(
        (ex) => !excludedNames.has(ex.name.trim().toLowerCase())
      );
      if (filtered.length !== catalog.length) {
        logger.info("Applied per-user exercise exclusions to generation catalog", {
          userId,
          excludedCount: catalog.length - filtered.length,
          operation: "getFilteredExercises",
        });
      }
      return filtered;
    } catch (error) {
      logger.warn(
        "Failed to apply user exercise exclusions; continuing with full catalog",
        {
          userId,
          error: (error as Error).message,
          operation: "getFilteredExercises",
        }
      );
      return catalog;
    }
  }

  private async getSharedGenerationCatalog(
    profile: Profile
  ): Promise<ExerciseMetadata[]> {
    const cacheKey = this.exerciseCacheKey(profile);
    const cached = exerciseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.exercises;
    }

    try {
      let equipment: string[] | undefined;
      if (profile.environment === "bodyweight_only") {
        equipment = ["bodyweight"];
      } else if (profile.environment === "home_gym" && profile.equipment) {
        equipment = Array.isArray(profile.equipment)
          ? profile.equipment
          : [profile.equipment];
      }

      // Full equipment-eligible pool -> limitation filter -> stratified
      // selection. Order matters twice: limitations run over the whole pool
      // so banned movements never consume menu slots, and stratifyCatalog
      // replaces the old unordered LIMIT 200 (an arbitrary, non-deterministic
      // slice for commercial-gym users) with per-muscle-group round-robin
      // ranked by the user's preferred styles, demo availability, then name.
      const pool = await exerciseService.getGenerationCatalogPool(equipment);
      // [LR-013] The primary enforcement point: exclude contraindicated
      // exercises before the LLM ever sees them as an option, rather than
      // relying solely on the post-generation check below for exercisesToAdd.
      const allowed = filterExercisesByLimitations(pool, profile);
      const exercises = stratifyCatalog(allowed, {
        preferredStyles: profile.preferredStyles as string[] | null,
        limit: GENERATION_CATALOG_SIZE,
      });
      exerciseCache.set(cacheKey, { exercises, expiresAt: Date.now() + EXERCISE_CACHE_TTL_MS });

      logger.info("Generation catalog selected", {
        cacheKey,
        resultCount: exercises.length,
        poolCount: pool.length,
        excludedByLimitations: pool.length - allowed.length,
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

    // [PERF-06] Render each exercise ONCE with its muscle groups as a field,
    // rather than repeating the full entry under every muscle-group heading it
    // belongs to. The old grouped format duplicated each exercise ~2x (once per
    // muscle group), roughly doubling the ~22KB catalog block that rides on every
    // day-call prompt. This flat list carries the same information (name, muscle
    // groups, equipment, difficulty) at ~half the tokens.
    let context = "";
    exercises.forEach((exercise) => {
      const muscleGroups =
        exercise.muscleGroups && exercise.muscleGroups.length > 0
          ? exercise.muscleGroups.join(", ")
          : "general";
      const equipmentList =
        exercise.equipment && exercise.equipment.length > 0
          ? exercise.equipment.join(", ")
          : "bodyweight";
      const difficulty = exercise.difficulty || "moderate";

      context += `- **${exercise.name}** (muscle groups: ${muscleGroups}; equipment: ${equipmentList}; difficulty: ${difficulty})\n`;
    });

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

    // [LR-013 transparency] When the limitation filter has removed movement
    // patterns from the catalog, the model must SAY so instead of naming a
    // block after a movement it wasn't allowed to include (the "Deadlift
    // Strength with no deadlifts" failure — the request is unsatisfiable and
    // the user has no way to know why or that retrying can't help).
    const contraindications = describeContraindications(
      profile.limitations as PhysicalLimitation[] | null
    );
    const limitationTransparency =
      contraindications.length === 0
        ? ""
        : `

## PHYSICAL LIMITATION EXCLUSIONS — BE TRANSPARENT

For safety, the exercise list above ALREADY EXCLUDES these movement patterns, because of limitations on the user's profile:
${contraindications.map((line) => `- ${line}`).join("\n")}

If the user's request asks for an excluded movement (e.g. they ask for good mornings but their profile lists Lower Back Pain):
1. Do NOT name the workout or any block after the excluded movement — names must describe what the workout actually contains.
2. Choose the closest safe alternatives from the available exercise list.
3. In the workout "description" field, state plainly which requested movement was excluded and which profile limitation excluded it, and tell the user they can change this under Profile > Limitations if it no longer applies. Example: "You asked for good mornings, but they're excluded by the Lower Back Pain setting on your profile — this session uses back-friendly hip-hinge work instead. If they should be allowed, update your limitations in your profile."
NEVER silently substitute and present the workout as if it contained the requested movement.`;

    // Caution tier: these movements stayed IN the catalog despite the user's
    // limitations, on the condition that the model programs them
    // conservatively. Without this section the model would treat them like
    // any other exercise.
    const cautions = describeCautions(
      profile.limitations as PhysicalLimitation[] | null
    );
    const limitationCautions =
      cautions.length === 0
        ? ""
        : `

## LIMITATION CAUTION MOVEMENTS — PROGRAM CONSERVATIVELY

These movement patterns are PERMITTED despite the user's limitations, but ONLY with conservative programming:
${cautions.map((line) => `- ${line}`).join("\n")}

Whenever you include one of them:
1. Light-to-moderate load only (RPE 7 max), controlled tempo, modest volume.
2. NEVER place it inside an AMRAP, EMOM, or max-effort circuit.
3. Add a short form/safety cue to that exercise's "notes" field referencing the limitation (e.g. "Keep spine neutral; stop if your lower back tightens").
4. Prefer an unrestricted alternative when it serves the session's goal equally well — use caution movements when the user asks for them or they clearly fit the goal.`;

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
${limitationTransparency}${limitationCautions}
## CRITICAL REMINDER: VALID JSON OUTPUT ONLY

Your final response MUST be a valid JSON workout plan following the exact structure specified in the prompt above.
No explanations or text outside the JSON structure in your final response.`;

    return this.buildProviderAwareSystemMessage(enhancedSystemContent);
  }

  /**
   * cache_control is an Anthropic-specific content-block field; other
   * providers' APIs can reject unknown fields, so non-Anthropic providers
   * get a plain string system message.
   */
  private buildProviderAwareSystemMessage(text: string): SystemMessage {
    if (this.currentProvider !== AIProvider.ANTHROPIC) {
      return new SystemMessage(text);
    }
    return new SystemMessage({
      content: [
        {
          type: "text",
          text,
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

      // Fire-and-forget — must not block or throw on the generation hot path
      void llmGenerationLogsService.insert({
        userId,
        operation: "regenerateWorkout",
        provider: this.currentProvider,
        model: this.currentModel,
        llmDurationMs,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        cacheReadInputTokens: usageMetadata?.input_token_details?.cache_read ?? 0,
        cacheCreationInputTokens: usageMetadata?.input_token_details?.cache_creation ?? 0,
      });

      // Add the exchange to history
      await messageHistory.addMessage(userMessage);
      await messageHistory.addMessage(response);

      // Clean up the active generation
      this.activeGenerations.delete(generationKey);

      // Parse and validate: this serial path has no structured-output
      // enforcement (unlike fan-out), so shape problems must be caught here
      // rather than surfacing as persistence failures or silent drops.
      const cleanedResponse = this.cleanJsonResponse(
        response.content as string
      );
      const parsed = JSON.parse(cleanedResponse);
      let workout = dayNumber
        ? validateDailyGenerationResponse(parsed)
        : validateWeeklyGenerationResponse(parsed);

      // [Duration budget] The prompt demands workoutDuration ±5 min but
      // nothing checked the answer, so overshoots persisted unchecked (prod:
      // a 20-min request produced a 40-min day). One corrective retry on
      // overshoot; if it still doesn't fit, keep the closer attempt rather
      // than failing the user's request.
      if (dayNumber && !isRestDay) {
        const targetMinutes = profile.workoutDuration || 30;
        const totalMinutes = sumBlockMinutes(workout);
        if (totalMinutes > targetMinutes + DURATION_TOLERANCE_MINUTES) {
          logger.warn("Daily workout exceeds duration budget — corrective retry", {
            userId,
            operation: "regenerateWorkout",
            metadata: { targetMinutes, totalMinutes },
          });
          try {
            const correctiveMessage = new HumanMessage(
              `The workout you just returned totals ${totalMinutes} minutes of blockDurationMinutes, but the session budget is ${targetMinutes} minutes (at most ${targetMinutes + DURATION_TOLERANCE_MINUTES}). Trim it to fit: reduce sets, drop accessory exercises, or shorten/remove blocks while keeping the session's focus and all naming/transparency rules. Respond with the corrected complete workout JSON only.`
            );
            const retryStartedAt = Date.now();
            const retryResponse = await this.llm.invoke(
              [systemMessage, ...existingMessages, userMessage, response, correctiveMessage],
              { signal: abortController.signal }
            );
            const retryDurationMs = Date.now() - retryStartedAt;

            const retryUsage = (retryResponse as AIMessage).usage_metadata;
            tokenUsage.inputTokens += retryUsage?.input_tokens || 0;
            tokenUsage.outputTokens += retryUsage?.output_tokens || 0;
            tokenUsage.totalTokens += retryUsage?.total_tokens || 0;
            void llmGenerationLogsService.insert({
              userId,
              operation: "regenerateWorkout",
              provider: this.currentProvider,
              model: this.currentModel,
              llmDurationMs: retryDurationMs,
              inputTokens: retryUsage?.input_tokens || 0,
              outputTokens: retryUsage?.output_tokens || 0,
              totalTokens: retryUsage?.total_tokens || 0,
              cacheReadInputTokens: retryUsage?.input_token_details?.cache_read ?? 0,
              cacheCreationInputTokens: retryUsage?.input_token_details?.cache_creation ?? 0,
            });

            const retryWorkout = validateDailyGenerationResponse(
              JSON.parse(this.cleanJsonResponse(retryResponse.content as string))
            );
            const retryTotal = sumBlockMinutes(retryWorkout);
            // Keep whichever attempt lands closer to the budget.
            if (
              Math.abs(retryTotal - targetMinutes) <
              Math.abs(totalMinutes - targetMinutes)
            ) {
              workout = retryWorkout;
              await messageHistory.addMessage(correctiveMessage);
              await messageHistory.addMessage(retryResponse);
            }
            logger.info("Duration corrective retry finished", {
              userId,
              operation: "regenerateWorkout",
              metadata: {
                targetMinutes,
                firstTotal: totalMinutes,
                retryTotal,
                kept: workout === retryWorkout ? "retry" : "original",
              },
            });
          } catch (retryError) {
            // Never fail the user's request because the corrective pass broke.
            logger.warn("Duration corrective retry failed — keeping original", {
              userId,
              operation: "regenerateWorkout",
              metadata: { error: (retryError as Error).message },
            });
          }
        }
      }

      return {
        workout,
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
      // [GQ-08] Recent post-workout feedback, kept SEPARATE from the live
      // request (customFeedback) so the prompt can label them with explicit
      // precedence instead of blending them into one opaque string.
      recentFeedback?: string;
      // [GQ-01] Resolved scheduling start date (YYYY-MM-DD) from the caller, so
      // the prompt labels match the dates the caller stamps. When omitted (e.g.
      // the eval harness), we resolve from profile.timezone.
      scheduleStartDate?: string;
    }
  ): Promise<WorkoutGenerationResult> {
    const { signal, onProgress, recentFeedback } = options || {};
    const startedAt = Date.now();

    // [GQ-08] The two feedback channels, bundled for the prompt builders.
    const promptFeedback: PromptFeedback = { customFeedback, recentFeedback };

    // [GQ-01] Compute the day-number -> {weekday, date} schedule up front so the
    // prompts can label each slot with its real weekday/date and the persistence
    // layer can stamp the identical dates (single source of truth). Prefer the
    // caller's already-resolved start date (which uses the request-timezone
    // precedence that startDate/endDate are stamped with); fall back to
    // profile.timezone for direct callers.
    const scheduleStartDate =
      options?.scheduleStartDate ||
      (profile.timezone
        ? getCurrentDateStringInTimezone(profile.timezone)
        : getCurrentDateString());
    // `let` because a GQ-02 scheduling override (extracted by the planning call)
    // can recompute this after planning.
    let schedule = buildPlanDaySchedule(
      profile.availableDays,
      scheduleStartDate
    );

    // Abort scope for the fan-out: forwards an external abort, and lets a
    // terminal day failure cancel sibling in-flight calls instead of letting
    // them run (and bill) to completion after the result is already doomed.
    const fanoutAbort = new AbortController();
    if (signal) {
      if (signal.aborted) fanoutAbort.abort();
      else signal.addEventListener("abort", () => fanoutAbort.abort());
    }

    // Two separate system messages:
    //   planningSystemMessage — no exercise list; the planner only designs
    //     the week split (names, focus, muscle groups) and never touches
    //     exercises. Omitting ~4 000 tokens of exercise context meaningfully
    //     cuts planning TTFT.
    //   daySystemMessage — full exercise context with cache_control so the
    //     expensive prefix is paid once and shared across all parallel day
    //     calls. Note: planning and day calls bind different tool schemas, so
    //     the planning cache does NOT warm the day cache — day calls warm
    //     each other, which pays off on retries and repeat generations within
    //     the 5-min cache TTL.
    const availableExercises = await this.getFilteredExercises(profile);
    const exerciseContext = this.formatExerciseContext(availableExercises);

    // [LR-014] Week-over-week progression: nudge intensity based on how much
    // of last week the user actually completed. First pass — completion-rate
    // based, not per-exercise weight/rep tracking (see progression-context.ts).
    let progressionContext = "";
    try {
      const previousWeeks = await workoutService.getPreviousWorkouts(
        userId,
        "week"
      );
      const mostRecentCompletionRate = previousWeeks[0]?.completionRate ?? null;
      progressionContext = buildProgressionContext(mostRecentCompletionRate);
    } catch (error) {
      // Progression context is an enhancement, not a requirement — never
      // block generation on it.
      logger.warn("Failed to fetch previous week for progression context", {
        userId,
        operation: "generateWeeklyWorkout",
        error: (error as Error).message,
      });
    }

    // [GQ-14] Keep the assembled system text in plain strings so we can both
    // wrap them for the LLM AND snapshot exactly what was sent for forensics.
    const planningSystemText = `${buildFanoutSystemPrompt(profile)}${progressionContext}`;
    const daySystemText = `${buildFanoutSystemPrompt(profile)}${progressionContext}

## AVAILABLE EXERCISES FOR YOUR WORKOUTS

These exercises match the user's equipment and environment constraints:
${exerciseContext}`;
    const planningSystemMessage = this.buildProviderAwareSystemMessage(planningSystemText);
    const daySystemMessage = this.buildProviderAwareSystemMessage(daySystemText);

    // [GQ-14] Assembled-prompt snapshot accumulated as the calls are built. The
    // day system message is shared across every day, so it's stored once; each
    // day's volatile user message is captured as it's generated (keyed by day
    // number so retries/second-pass don't duplicate it).
    const promptSnapshot: {
      planning: { system: string; user: string };
      daySystem: string;
      days: Array<{ day: number; user: string }>;
    } = {
      planning: { system: planningSystemText, user: "" },
      daySystem: daySystemText,
      days: [],
    };
    const capturedDayMessages = new Map<number, string>();

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

    // 1. Planning call — small output (~300 tokens). Use Haiku 4.5 on
    //    Anthropic: the week-split task (names, focus, muscle groups) is
    //    well within its capabilities and it's significantly faster than
    //    Sonnet. Fall back to the user's selected model on other providers.
    const planLlmBase = this.currentProvider === AIProvider.ANTHROPIC
      ? aiProviderService.createLLMInstance(AIProvider.ANTHROPIC, FANOUT_PLANNING_MODEL)
      : this.llm;
    const planLlm = planLlmBase.withStructuredOutput(WEEK_PLAN_SCHEMA as any, {
      name: "week_plan",
      includeRaw: true,
    });
    logger.info("Starting fan-out planning call", {
      userId,
      expectedDayCount: profile.availableDays?.length || 7,
      provider: this.currentProvider,
      operation: "generateWeeklyWorkout",
    });
    // Wraps the planning call's timeout/usage plumbing. (The old muscle-balance
    // corrective SECOND planning call was replaced by a deterministic reorder in
    // GQ-10, so this now runs exactly once.)
    const runPlanningCall = async (userMessage: string): Promise<WeekPlan> => {
      const result: any = await runWithAbortTimeout(
        (signal) =>
          planLlm.invoke(
            [planningSystemMessage, new HumanMessage(userMessage)],
            { signal }
          ),
        fanoutAbort.signal,
        PLANNING_CALL_TIMEOUT_MS,
        "Fan-out planning call"
      );
      recordUsage(result.raw);
      return result.parsed as WeekPlan;
    };
    const planningUserMessage = buildPlanningUserMessage(
      profile,
      schedule,
      promptFeedback
    );
    promptSnapshot.planning.user = planningUserMessage; // [GQ-14]
    let weekPlan = await runPlanningCall(planningUserMessage);

    // [GQ-02] Resolve any explicit scheduling override the planner extracted
    // (specific weekdays, day count, or start weekday) into effective schedule
    // inputs. When present, RECOMPUTE the schedule so the day-call labels and
    // the stamped dates reflect the user's request; the expected day count also
    // becomes the requested count. No override -> identical to the prior code
    // (effective.dayCount === profile.availableDays.length, schedule unchanged).
    // [GQ-02] Plausibility gate: only honor the planner's scheduling override
    // when the LIVE request actually asked to change the schedule. Guards
    // against a mis-extraction from calendar-content language ("keep Fridays
    // easy") or a stale recent-feedback note silently shrinking/shifting a week.
    const scheduleOverride = mentionsScheduleChange(customFeedback)
      ? weekPlan.constraints?.schedule
      : undefined;
    const effective = resolveEffectiveSchedule(
      scheduleOverride,
      profile.availableDays,
      scheduleStartDate
    );
    const expectedDayCount = effective.dayCount;
    if (effective.overridden) {
      schedule = buildPlanDaySchedule(
        effective.availableDays,
        effective.startDate,
        effective.dayCount
      );
      logger.info("Applied GQ-02 scheduling override", {
        userId,
        operation: "generateWeeklyWorkout",
        metadata: {
          availableDays: effective.availableDays,
          dayCount: effective.dayCount,
          startDate: effective.startDate,
        },
      });
    }
    logger.info("Fan-out planning call completed", {
      userId,
      returnedDayCount: weekPlan?.days?.length || 0,
      expectedDayCount,
      weekPlanName: weekPlan?.name,
      operation: "generateWeeklyWorkout",
    });
    if (!weekPlan?.days?.length || weekPlan.days.length < expectedDayCount) {
      throw new Error(
        `Week planning returned ${weekPlan?.days?.length || 0} days, expected ${expectedDayCount}`
      );
    }
    // The model controls the day fields — renumber sequentially and clamp to the
    // expected count so numbering always matches the (possibly overridden)
    // schedule, no matter what the planning call returned.
    weekPlan.days = weekPlan.days
      .slice(0, expectedDayCount)
      .map((day, index) => ({ ...day, day: index + 1 }));

    const planningDurationMs = Date.now() - startedAt;
    logger.info("Week plan ready", {
      userId,
      planName: weekPlan.name,
      dayCount: weekPlan.days.length,
      planningDurationMs,
      operation: "generateWeeklyWorkout",
    });

    // [LR-049/GQ-10] This is the one point in the pipeline with cross-day
    // context — the parallel per-day fan-out calls below don't see each other's
    // output, so consecutive-day muscle-group balance can only be enforced here,
    // against the planning stage's per-day focus assignments. Detection alone
    // wasn't enough (the planner sometimes ignores its own "no consecutive
    // same-muscle" instruction). GQ-10: instead of a second corrective LLM
    // planning call (which the planner often re-violated anyway), we DETERMINE-
    // istically reorder the days to break up consecutive same-muscle pairs — no
    // extra LLM call (a latency win), and reliable now that primaryMuscleGroups
    // come from the canonical enum so the overlap check actually matches.
    let muscleGroupOverloads = checkConsecutiveMuscleGroupOverload(
      weekPlan.days
    );
    // [GQ-10/GQ-01] Reordering moves a day's designed content onto a different
    // calendar slot. When the user referenced a specific weekday (GQ-01 tells
    // the planner to honor "keep Fridays easy", "light before my Saturday run"),
    // that content is date-locked — reordering would silently break exactly the
    // calendar request we just enabled. So skip the reorder when the request is
    // calendar-sensitive; muscle balance yields to the explicit user ask (the
    // residual overload is still logged below).
    const calendarSensitive = mentionsWeekday(customFeedback);
    if (muscleGroupOverloads.length > 0 && !calendarSensitive) {
      const reordered = reorderToMinimizeConsecutiveOverload(weekPlan.days);
      const reorderedOverloads = checkConsecutiveMuscleGroupOverload(reordered);
      if (reorderedOverloads.length < muscleGroupOverloads.length) {
        logger.info("Reordered week to reduce consecutive muscle overload", {
          userId,
          operation: "generateWeeklyWorkout",
          metadata: {
            before: muscleGroupOverloads.length,
            after: reorderedOverloads.length,
          },
        });
        weekPlan = { ...weekPlan, days: reordered };
        muscleGroupOverloads = reorderedOverloads;
      }
    } else if (muscleGroupOverloads.length > 0 && calendarSensitive) {
      logger.info(
        "Skipping muscle-overload reorder — request references a weekday, preserving calendar intent",
        { userId, operation: "generateWeeklyWorkout" }
      );
    }
    // Any overload still present after the deterministic reorder — surface it.
    for (const finding of muscleGroupOverloads) {
      logger.warn(
        "Consecutive days share a primary muscle group focus (post reorder)",
        {
          userId,
          operation: "generateWeeklyWorkout",
          ...finding,
        }
      );
    }
    onProgress?.({
      type: "plan_ready",
      days: weekPlan.days.map((d) => ({ dayNumber: d.day, label: d.name })),
    });

    // Per-phase timing — measured so we optimize the real bottleneck rather
    // than guess. `dayTimings` captures each day call's wall-clock (the LLM
    // round-trip, excluding the upfront stagger) and the attempt it succeeded
    // on; the days phase as a whole is timed from here.
    const daysPhaseStartedAt = Date.now();
    const dayTimings: { dayNumber: number; durationMs: number; attempts: number }[] = [];

    // 2. Day calls — staggered starts (800 ms between each), then parallel.
    //
    // Model: Haiku 4.5 on Anthropic. Day generation is a structured
    // selection/parameterisation task (pick exercises from the filtered list,
    // assign sets/reps/weights/blocks within the plan already designed by
    // the planning call). Haiku 4.5 handles it capably and cuts per-call
    // latency from ~20 s (Sonnet 4.5) to ~4-6 s, which is the dominant
    // win here. Other providers fall back to the user's selected model.
    //
    // Staggering distributes completions visibly: each day's checkmark
    // appears staggered after the previous one instead of all arriving in
    // a burst. Cache: later calls also benefit from the Anthropic
    // prompt-cache entry established by the first call.
    //
    // [LR-037] Confirmed via git archaeology (commit e9f7d84) this was NEVER
    // about rate limits/lock contention — purely UI pacing for the
    // day_started progress event. That means shrinking it has no
    // rate-limit risk to worry about, only a UX trade-off: since the
    // slowest day gates the whole phase, the stagger's overhead
    // ((n-1) × stagger) lands directly on total generation time, not just
    // on how the progress bar looks. Reduced 800ms->300ms: still reads as
    // "one at a time" visually (a perceptible gap), cuts worst-case
    // overhead for a 7-day week from 4.8s to 1.8s. Judgment call, not
    // measured on a live run — worth a quick on-device sanity check that
    // the progress reveal still looks reasonable, not the exact 300ms
    // value being sacred.
    const DAY_STAGGER_MS = 300;
    // [PERF-03] Give day 0 a head start before the rest of the week fans out, so its
    // ~14K-token shared system prefix is written to Anthropic's prompt cache before the
    // sibling days try to read it. With the old 300ms-only stagger, the early days fire
    // well before that write lands and each pays the full prefix write instead of a
    // ~0.1x cache read. Kept in the same ballpark as the old last-day stagger (~1.8s) to
    // avoid a latency regression. TUNE against `cacheHitPct` in the llm-metrics report;
    // set to 0 to restore the old pure-stagger behavior.
    const CACHE_WARM_MS = 1500;
    // [PERF-04] Cap concurrent day calls per generation. Cheap insurance against
    // account-level Anthropic rate limits when several generations run at once.
    const MAX_CONCURRENT_DAYS = 5;
    const daySemaphore = new Semaphore(MAX_CONCURRENT_DAYS);
    const dayLlmBase = this.currentProvider === AIProvider.ANTHROPIC
      ? aiProviderService.createLLMInstance(AIProvider.ANTHROPIC, FANOUT_DAY_MODEL)
      : this.llm;
    const dayLlm = dayLlmBase.withStructuredOutput(WORKOUT_DAY_SCHEMA as any, {
      name: "workout_day",
      includeRaw: true,
    });
    const MAX_ATTEMPTS = 2;
    const generateDay = async (day: WeekPlan["days"][number], staggerMs: number) => {
      // Stagger: wait before starting this day's LLM call.
      if (staggerMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, staggerMs));
        if (fanoutAbort.signal.aborted) throw new Error("Aborted before day start");
      }

      // Signal that this day's call is now in-flight.
      onProgress?.({ type: "day_started", dayNumber: day.day });

      // [GQ-14] Capture this day's assembled user message once (retries and the
      // second pass reuse the same text).
      const dayUserMessage = buildDayUserMessage(
        profile,
        weekPlan,
        day,
        schedule,
        promptFeedback
      );
      if (!capturedDayMessages.has(day.day)) {
        capturedDayMessages.set(day.day, dayUserMessage);
      }

      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const callStartedAt = Date.now();
        try {
          // [PERF-04] Gate the actual LLM call through the semaphore so no more
          // than MAX_CONCURRENT_DAYS day calls are in flight at once.
          const res: any = await daySemaphore.run(() =>
            runWithAbortTimeout(
              (signal) =>
                dayLlm.invoke(
                  [daySystemMessage, new HumanMessage(dayUserMessage)],
                  { signal }
                ),
              fanoutAbort.signal,
              DAY_CALL_TIMEOUT_MS,
              `Day ${day.day} generation`
            )
          );
          recordUsage(res.raw);
          if (!res.parsed?.blocks?.length) {
            throw new Error(`Day ${day.day} generation returned no blocks`);
          }
          const dayDurationMs = Date.now() - callStartedAt;
          dayTimings.push({ dayNumber: day.day, durationMs: dayDurationMs, attempts: attempt });
          logger.info("Day generation completed", {
            userId,
            dayNumber: day.day,
            dayDurationMs,
            attempt,
            operation: "generateWeeklyWorkout",
          });
          onProgress?.({ type: "day_done", dayNumber: day.day });
          // Same zod normalization as the serial path (heals scalars, drops
          // invalid protocolConfig, reconciles repScheme vs rounds) so both
          // generation paths persist identical semantics. Don't trust the
          // model's echoed day number — it determines week ordering and
          // date assignment downstream.
          return { ...validateDailyGenerationResponse(res.parsed), day: day.day };
        } catch (error) {
          lastError = error;
          if (fanoutAbort.signal.aborted) break;
          if (attempt < MAX_ATTEMPTS) {
            logger.warn("Day generation failed, retrying", {
              userId,
              dayNumber: day.day,
              attempt,
              error: (error as Error).message,
              operation: "generateWeeklyWorkout",
            });
          }
        }
      }
      onProgress?.({ type: "day_failed", dayNumber: day.day });
      // [PERF-02] A single day failing must NOT cancel its siblings. This used to
      // call fanoutAbort.abort(), discarding every successfully-generated day and
      // forcing a full whole-week regeneration on the pricier fallback model for one
      // transient blip. Now we just surface the failure; the caller keeps the good
      // days and retries only the failed one(s).
      throw lastError;
    };

    // [PERF-03] Schedule day 0 immediately; hold the rest until CACHE_WARM_MS so
    // day 0's shared prompt prefix is cached before its siblings read it, then
    // stagger normally.
    const daySchedule = (i: number): number =>
      i === 0 ? 0 : CACHE_WARM_MS + (i - 1) * DAY_STAGGER_MS;

    const firstPass = await Promise.allSettled(
      weekPlan.days.map((day, i) => generateDay(day, daySchedule(i)))
    );

    const generatedDays: any[] = [];
    const failedDays: WeekPlan["days"] = [];
    firstPass.forEach((result, i) => {
      if (result.status === "fulfilled") {
        generatedDays.push(result.value);
      } else {
        failedDays.push(weekPlan.days[i]);
      }
    });

    // [PERF-02] Second pass: retry only the day(s) that failed, sequentially and
    // without stagger — so one transient failure no longer discards the whole week.
    if (failedDays.length > 0 && !fanoutAbort.signal.aborted) {
      logger.warn("Retrying failed fan-out days individually", {
        userId,
        operation: "generateWeeklyWorkout",
        metadata: { failedDayCount: failedDays.length },
      });
      for (const day of failedDays) {
        if (fanoutAbort.signal.aborted) break;
        try {
          generatedDays.push(await generateDay(day, 0));
        } catch (error) {
          logger.warn("Day still failed after individual retry", {
            userId,
            dayNumber: day.day,
            operation: "generateWeeklyWorkout",
            error: (error as Error).message,
          });
        }
      }
    }

    // If we still can't produce every day, fall back to the serial whole-week path
    // (the caller catches this and regenerates) — the existing safety net, now only
    // after genuinely trying to preserve the days that did succeed.
    if (generatedDays.length < weekPlan.days.length) {
      throw new Error(
        `Fan-out generation incomplete: ${generatedDays.length}/${weekPlan.days.length} days succeeded`
      );
    }

    const daysPhaseDurationMs = Date.now() - daysPhaseStartedAt;
    const slowestDayMs = dayTimings.reduce((m, d) => Math.max(m, d.durationMs), 0);
    const retriedDays = dayTimings.filter((d) => d.attempts > 1).length;

    // 3. Assemble the legacy single-call response shape
    const rawExercisesToAdd: any[] = [];
    const seenNewExercises = new Set<string>();
    const rawWorkoutPlan = generatedDays
      .sort((a, b) => a.day - b.day)
      .map((generatedDay) => {
        const {
          exercisesToAdd: dayExercises,
          limitationConcerns,
          ...dayPlan
        } = generatedDay;
        for (const exercise of dayExercises || []) {
          const key = exercise.name?.toLowerCase();
          if (key && !seenNewExercises.has(key)) {
            seenNewExercises.add(key);
            rawExercisesToAdd.push(exercise);
          }
        }
        // [LR-013] Log-and-allow: the LLM's own self-reported borderline
        // calls, surfaced for visibility — not auto-removed, since these are
        // exercises it deliberately decided to keep despite the flag.
        if (limitationConcerns?.length) {
          logger.warn("LLM flagged borderline exercises for user's limitations", {
            userId,
            operation: "generateWeeklyWorkout",
            metadata: {
              day: dayPlan.day,
              limitations: profile.limitations,
              limitationConcerns,
            },
          });
        }
        return dayPlan;
      });

    // [LR-012/LR-013/LR-049] Post-generation validation pipeline — equipment
    // filter, then limitation filter, then [GQ-07] AVOID enforcement, then
    // repetition check against the final filtered plan. Extracted to
    // post-generation-validation.ts [LR-019] so the wiring between these
    // validators is directly testable, not just each validator individually.
    const {
      exercisesToAdd,
      workoutPlan,
      repetitionFindings,
      constraintFindings,
      durationFindings,
      muscleAlignmentFindings,
      muscleOverlapFindings,
    } = applyPostGenerationValidation(rawExercisesToAdd, rawWorkoutPlan, profile, {
        // [GQ-07] Deterministic backstop for the user's exclusion requests: swap
        // or drop any generated exercise matching a banned term, drawing swaps
        // from the same catalog the generation used. Makes AVOID compliance
        // reliable instead of relying on the model honoring the prose.
        avoidExerciseTerms: weekPlan.constraints?.avoidExerciseTerms,
        catalog: availableExercises.map((e: any) => ({
          name: e.name,
          muscleGroups: e.muscleGroups,
          tag: e.tag, // [GQ-11] style tag keeps focus-alignment swaps same-modality
        })),
        // [GQ-11] Per-day intended focus (from the plan) + calendar-adjacent day
        // pairs (from the schedule) drive the muscle-load alignment + overlap
        // check on the ACTUAL exercises. GQ11_ALIGN_DISABLED skips the alignment
        // repair (overlap is still detected/logged) — used only to measure the
        // before/after in the eval harness.
        dayFocus: process.env.GQ11_ALIGN_DISABLED
          ? undefined
          : new Map(
              weekPlan.days.map((d) => [d.day, d.primaryMuscleGroups || []])
            ),
        adjacentPairs: computeAdjacentDayPairs(schedule),
      });

    for (const finding of repetitionFindings) {
      logger.warn("Exercise repeated more than expected within one day", {
        userId,
        operation: "generateWeeklyWorkout",
        ...finding,
      });
    }

    // [GQ-07] Surface every AVOID violation the model let through and how it was
    // repaired — these are exactly the "feature didn't listen" moments to watch.
    for (const finding of constraintFindings) {
      logger.warn("AVOID constraint violation repaired post-generation", {
        userId,
        operation: "generateWeeklyWorkout",
        ...finding,
      });
    }

    // [Duration] Surface days that the model under-programmed and we padded to
    // hit the user's target — a signal to watch (how often, and by how much).
    for (const finding of durationFindings) {
      logger.warn("Under-target day padded to meet duration target", {
        userId,
        operation: "generateWeeklyWorkout",
        ...finding,
      });
    }

    // [GQ-11] What the focus-alignment swapped, and any consecutive-day muscle
    // overlap still present — the muscle-balance compliance signal.
    for (const finding of muscleAlignmentFindings) {
      logger.info("Realigned off-focus exercise to reduce muscle overload", {
        userId,
        operation: "generateWeeklyWorkout",
        ...finding,
      });
    }
    for (const finding of muscleOverlapFindings) {
      logger.warn("Consecutive days heavily load the same muscle (residual)", {
        userId,
        operation: "generateWeeklyWorkout",
        ...finding,
      });
    }

    const totalDurationMs = Date.now() - startedAt;
    logger.info("Fan-out weekly generation complete", {
      userId,
      dayCount: workoutPlan.length,
      newExerciseCount: exercisesToAdd.length,
      totalDurationMs,
      // Phase breakdown: planning (one Haiku call) vs the parallel days phase.
      // slowestDayMs is the tail that gates the days phase; retriedDays flags
      // calls that needed a second attempt (a latency contributor).
      planningDurationMs,
      daysPhaseDurationMs,
      slowestDayMs,
      retriedDays,
      perDayMs: dayTimings.sort((a, b) => a.dayNumber - b.dayNumber),
      tokenUsage: usageTotals,
      cacheReadTokens,
      cacheCreationTokens,
      operation: "generateWeeklyWorkout",
    });

    // [GQ-14] Finalize the assembled-prompt snapshot (day messages in order).
    promptSnapshot.days = [...capturedDayMessages.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, user]) => ({ day, user }));

    // Fire-and-forget — must not block or throw on the generation hot path.
    // `model` is the user's profile selection; on Anthropic the fan-out path
    // overrides it, so planningModel/dayModel record what actually ran.
    void llmGenerationLogsService.insert({
      userId,
      operation: "generateWeeklyWorkout",
      provider: this.currentProvider,
      model: this.currentModel,
      promptSnapshot: JSON.stringify(promptSnapshot),
      planningModel:
        this.currentProvider === AIProvider.ANTHROPIC
          ? FANOUT_PLANNING_MODEL
          : this.currentModel,
      dayModel:
        this.currentProvider === AIProvider.ANTHROPIC
          ? FANOUT_DAY_MODEL
          : this.currentModel,
      llmDurationMs: totalDurationMs,
      inputTokens: usageTotals.inputTokens,
      outputTokens: usageTotals.outputTokens,
      totalTokens: usageTotals.totalTokens,
      cacheReadInputTokens: cacheReadTokens,
      cacheCreationInputTokens: cacheCreationTokens,
    });

    return {
      workout: {
        name: weekPlan.name,
        description: weekPlan.description,
        workoutPlan,
        exercisesToAdd,
      },
      tokenUsage: usageTotals,
      // [GQ-01] Hand the schedule back so persistence stamps the identical dates.
      schedule,
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

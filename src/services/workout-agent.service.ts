import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  type UsageMetadata,
} from "@langchain/core/messages";
import { Profile } from "@/models";
import { filterExercisesByLimitations } from "@/utils/limitation-validation";
import { checkConsecutiveMuscleGroupOverload } from "@/utils/workout-balance-validation";
import { applyPostGenerationValidation } from "@/utils/post-generation-validation";
import { buildProgressionContext } from "@/utils/progression-context";
import { workoutService } from "./workout.service";
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
import { llmGenerationLogsService } from "./llm-generation-logs.service";
import { runWithAbortTimeout } from "@/utils/timeout.utils";
import { Semaphore } from "@/utils/concurrency.utils";

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
    return `${profile.environment}:${equipment}:${limitations}`;
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

      const rawExercises = await exerciseService.searchExercises(filters);
      // [LR-013] The primary enforcement point: exclude contraindicated
      // exercises before the LLM ever sees them as an option, rather than
      // relying solely on the post-generation check below for exercisesToAdd.
      const exercises = filterExercisesByLimitations(rawExercises, profile);
      exerciseCache.set(cacheKey, { exercises, expiresAt: Date.now() + EXERCISE_CACHE_TTL_MS });

      logger.info("Exercise search completed", {
        cacheKey,
        resultCount: exercises.length,
        excludedByLimitations: rawExercises.length - exercises.length,
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

    const planningSystemMessage = this.buildProviderAwareSystemMessage(
      `${buildFanoutSystemPrompt(profile)}${progressionContext}`
    );
    const daySystemMessage = this.buildProviderAwareSystemMessage(
      `${buildFanoutSystemPrompt(profile)}${progressionContext}

## AVAILABLE EXERCISES FOR YOUR WORKOUTS

These exercises match the user's equipment and environment constraints:
${exerciseContext}`
    );

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
    const planResult: any = await runWithAbortTimeout(
      (signal) =>
        planLlm.invoke(
          [planningSystemMessage, new HumanMessage(buildPlanningUserMessage(profile, customFeedback))],
          { signal }
        ),
      fanoutAbort.signal,
      PLANNING_CALL_TIMEOUT_MS,
      "Fan-out planning call"
    );
    recordUsage(planResult.raw);
    const weekPlan = planResult.parsed as WeekPlan;
    const expectedDayCount = profile.availableDays?.length || 7;
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
    // The model controls the day fields — renumber sequentially so the day
    // count and numbering always match the user's available days, no matter
    // what the planning call returned.
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

    // [LR-049] This is the one point in the pipeline with cross-day context —
    // the parallel per-day fan-out calls below don't see each other's
    // output, so consecutive-day muscle-group balance can only be checked
    // here, against the planning stage's per-day focus assignments.
    const muscleGroupOverloads = checkConsecutiveMuscleGroupOverload(
      weekPlan.days
    );
    for (const finding of muscleGroupOverloads) {
      logger.warn("Consecutive days share a primary muscle group focus", {
        userId,
        operation: "generateWeeklyWorkout",
        ...finding,
      });
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
                  [
                    daySystemMessage,
                    new HumanMessage(buildDayUserMessage(profile, weekPlan, day, customFeedback)),
                  ],
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
          // Don't trust the model's echoed day number — it determines week
          // ordering and date assignment downstream.
          return { ...res.parsed, day: day.day };
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
    // filter, then limitation filter, then repetition check against the
    // final filtered plan. Extracted to post-generation-validation.ts
    // [LR-019] so the wiring between these three is directly testable, not
    // just each validator individually.
    const { exercisesToAdd, workoutPlan, repetitionFindings } =
      applyPostGenerationValidation(rawExercisesToAdd, rawWorkoutPlan, profile);

    for (const finding of repetitionFindings) {
      logger.warn("Exercise repeated more than expected within one day", {
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

    // Fire-and-forget — must not block or throw on the generation hot path.
    // `model` is the user's profile selection; on Anthropic the fan-out path
    // overrides it, so planningModel/dayModel record what actually ran.
    void llmGenerationLogsService.insert({
      userId,
      operation: "generateWeeklyWorkout",
      provider: this.currentProvider,
      model: this.currentModel,
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

import { InsertPrompt, Profile, Prompt, prompts } from "@/models";
import { BaseService } from "./base.service";
import { logsService } from "./logs.service";
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
  AI_PROVIDERS,
  getModelConfig,
} from "@/constants/ai-providers";
import { PlanDaySlot } from "@/utils/plan-schedule";
// Result type that includes token usage
export interface PromptGenerationResult {
  response: any;
  promptId: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  // [GQ-01] Day-number -> {weekday, date} schedule the fan-out prompts were
  // built against, so persistence stamps the identical dates. Only the fan-out
  // path (generateChunkedPrompt) sets it; the serial path leaves it undefined.
  schedule?: PlanDaySlot[];
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

// Answer values → prompt-friendly phrases for the recent-feedback digest.
const FEEDBACK_PHRASES: Record<string, string> = {
  too_easy: "too easy",
  just_right: "just right",
  too_hard: "too hard",
  finished_early: "finished early",
  about_right: "about right",
  ran_out: "ran out of time",
  ran_out_of_time: "ran out of time",
  something_hurt: "something hurt",
  lost_interest: "lost interest",
  interrupted: "just got interrupted",
};

export class PromptsService extends BaseService {
  constructor() {
    super();
  }

  /**
   * [GQ-08] Build the recent post-workout feedback digest as a STANDALONE block
   * (no base string prepended), so the fan-out path can present it as its own
   * precedence-labeled section separate from the live request. Effort answers
   * steer intensity; time answers steer volume — the reason the feedback card
   * asks them separately. Returns undefined when there is nothing to say.
   * Failure-safe: generation must never break because the digest couldn't build.
   */
  private async buildRecentFeedbackDigest(
    userId: number
  ): Promise<string | undefined> {
    try {
      const recent = await logsService.getRecentPlanDayFeedback(userId, 5);
      const lines = recent
        .map((f) => {
          const parts: string[] = [];
          if (f.effort)
            parts.push(`effort felt ${FEEDBACK_PHRASES[f.effort] || f.effort}`);
          if (f.timeFit)
            parts.push(
              `session length: ${FEEDBACK_PHRASES[f.timeFit] || f.timeFit}`
            );
          if (f.endedEarlyReason)
            parts.push(
              `ended the workout early (${
                FEEDBACK_PHRASES[f.endedEarlyReason] || f.endedEarlyReason
              })`
            );
          if (f.note) parts.push(`note: "${f.note.slice(0, 200)}"`);
          if (parts.length === 0) return null;
          const day = f.updatedAt.toISOString().slice(0, 10);
          return `- ${day}: ${parts.join("; ")}`;
        })
        .filter((line): line is string => line !== null);
      if (lines.length === 0) return undefined;

      return (
        `Recent post-workout feedback from the user (newest first). ` +
        `Adjust INTENSITY for effort signals and total VOLUME (exercise count / sets) ` +
        `for time signals — a session that "ran out of time" means too much volume ` +
        `for the prescribed duration, not that the user wants harder exercises:\n` +
        lines.join("\n")
      );
    } catch (error) {
      logger.warn("Failed to build recent-feedback digest; continuing without", {
        userId,
        error: (error as Error).message,
        operation: "buildRecentFeedbackDigest",
      });
      return undefined;
    }
  }

  /**
   * Serial-path helper: append the recent-feedback digest to a base string. The
   * fan-out path uses buildRecentFeedbackDigest directly (separate section);
   * this preserves the blended behavior the serial prompt builders still expect.
   */
  private async withRecentFeedback(
    userId: number,
    base: string
  ): Promise<string> {
    const digest = await this.buildRecentFeedbackDigest(userId);
    return digest ? `${base}\n\n${digest}` : base;
  }

  // Create user-specific workout agent based on their AI provider preferences
  private async createUserWorkoutAgent(
    userId: number,
    existingProfile?: Profile
  ): Promise<WorkoutAgentService> {
    const profile =
      existingProfile ?? (await profileService.getProfileByUserId(userId));
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Use user's AI provider preferences if available, otherwise fallback to defaults
    const provider = profile.aiProvider || DEFAULT_AI_PROVIDER;
    let model = profile.aiModel || DEFAULT_AI_MODEL;

    // Fall back to the provider's default model if the stored model is no
    // longer valid (e.g., when a model is deprecated and removed from the
    // catalog)
    if (!getModelConfig(provider, model)) {
      const fallbackModel =
        AI_PROVIDERS[provider]?.defaultModel || DEFAULT_AI_MODEL;
      logger.warn(
        "Stored AI model is no longer valid, falling back to provider default",
        {
          userId,
          storedModel: model,
          fallbackModel,
          provider,
          operation: "createUserWorkoutAgent",
        }
      );
      model = fallbackModel;
    }

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

    // [LR-053] Used to throw here if availableDays/workoutDuration/environment
    // were missing. Removed: this is the serial fallback for when the
    // fan-out path (generateChunkedPrompt) fails, and fan-out already
    // tolerates the same gaps with defaults — a profile could succeed via
    // fan-out and then throw here on fallback for the exact same data.
    // buildClaudePrompt (called via regenerateWorkout -> buildSystemMessage)
    // now has matching defaults, so this guard is no longer needed.

    // Create user-specific workout agent
    const workoutAgent = await this.createUserWorkoutAgent(userId);

    // Generate a thread ID if not provided to enable conversation memory for all users
    const workoutThreadId = threadId || `workout_${userId}_${Date.now()}`;

    // Recent post-workout feedback rides along as generation input
    const enrichedFeedback = await this.withRecentFeedback(
      userId,
      customFeedback || "Generate weekly workout plan"
    );

    try {
      const result = await workoutAgent.regenerateWorkout(
        userId,
        profile,
        [], // exerciseNames no longer needed - agent uses tools
        workoutThreadId,
        enrichedFeedback,
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
    // [GQ-01] Resolved scheduling start date (YYYY-MM-DD in the request's
    // timezone) from the caller, so the schedule the prompts use matches the
    // dates the caller stamps. Falls back to profile-timezone resolution inside
    // generateWeeklyWorkout when omitted (e.g. the eval harness calls direct).
    scheduleStartDate?: string,
    signal?: AbortSignal
  ): Promise<PromptGenerationResult> {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }
    // Deliberately no availableDays/workoutDuration/environment guard here
    // (removed in 3229a60, confirmed still correct 2026-07-08): every actual
    // usage downstream (fanout-prompt-generator.ts) already has a safe
    // default (`?? 7`, `|| 30`, environment-aware equipment description).
    // The guard used to throw before this path could ever run, silently
    // forcing every request onto the slower serial path (generatePrompt
    // below) which emits no per-day progress — that's the "stuck on
    // spinner" bug this removal fixed. Do not re-add it.
    const workoutAgent = await this.createUserWorkoutAgent(userId, profile);

    emitGenerationStatus(userId, { progress: 15, phase: "planning" });

    let dayStatuses: GenerationDayStatus[] = [];
    const dayProgress = () => {
      const done = dayStatuses.filter((d) => d.status === "done").length;
      const total = dayStatuses.length || 1;
      // 25% = plan ready, 95% = all days generated; saving happens after
      return Math.round(25 + 70 * (done / total));
    };

    // [GQ-08] Keep the live request and the recent-feedback digest SEPARATE —
    // the fan-out prompt presents them as distinct, precedence-labeled sections
    // (current request wins) instead of blending them into one string where a
    // stale note carried the same weight as an explicit ask.
    const recentFeedback = await this.buildRecentFeedbackDigest(userId);

    try {
      const result = await workoutAgent.generateWeeklyWorkout(
        userId,
        profile,
        customFeedback,
        {
          signal,
          recentFeedback,
          scheduleStartDate,
          onProgress: (update) => {
            if (update.type === "plan_ready") {
              // Start every day as "pending" — each transitions to "generating"
              // when its staggered LLM call actually fires (day_started), so
              // the UI activates days one-by-one rather than all at once.
              dayStatuses = update.days.map((d) => ({
                dayNumber: d.dayNumber,
                label: d.label,
                status: "pending" as const,
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
              if (update.type === "day_started") {
                day.status = "generating";
              } else {
                day.status = update.type === "day_done" ? "done" : "failed";
              }
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
        // [GQ-01] Bubble the generation schedule up so the persistence layer
        // stamps the exact dates the prompts were built against.
        schedule: result.schedule,
      };
    } catch (error) {
      // INFO level so it survives any higher log-level filter — this is the
      // primary (per-day progress) path and its failure is what silently
      // demotes users to the spinner-only serial path.
      logger.info("Fan-out generation failed", {
        userId,
        operation: "generateChunkedPrompt",
        error: (error as Error)?.message,
        stack: (error as Error)?.stack,
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

    // Recent post-workout feedback rides along as generation input
    const enrichedFeedback = await this.withRecentFeedback(
      userId,
      regenerationData.customFeedback ||
        "Regenerate weekly workout plan with updated preferences"
    );

    try {
      const result = await workoutAgent.regenerateWorkout(
        userId,
        updatedProfile,
        [], // exerciseNames no longer needed - agent uses tools
        workoutThreadId,
        enrichedFeedback,
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
    signal?: AbortSignal,
    durationOverride?: number
  ): Promise<PromptGenerationResult> {
    const storedProfile = await profileService.getProfileByUserId(userId);
    if (!storedProfile) {
      throw new Error("Profile not found");
    }

    // The Adjust modal's session-minutes override applies to THIS generation
    // only. Substituting it into the profile here means every numeric
    // duration constraint in the prompt (and the post-generation budget
    // check) uses it — previously it rode along as prose in the reason while
    // the prompt kept demanding the stored profile duration.
    const profile =
      durationOverride !== undefined
        ? { ...storedProfile, workoutDuration: durationOverride }
        : storedProfile;

    // Create user-specific workout agent
    const workoutAgent = await this.createUserWorkoutAgent(userId);

    // Generate a thread ID if not provided to enable conversation memory for all users
    const workoutThreadId = threadId || `workout_daily_${userId}_${Date.now()}`;

    // Recent post-workout feedback rides along as generation input
    const enrichedReason = await this.withRecentFeedback(
      userId,
      regenerationReason
    );

    try {
      const result = await workoutAgent.regenerateWorkout(
        userId,
        profile,
        [], // exerciseNames no longer needed - agent uses tools
        workoutThreadId,
        enrichedReason,
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

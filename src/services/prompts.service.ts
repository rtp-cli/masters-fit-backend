import { InsertPrompt, Prompt, prompts } from "@/models";
import { BaseService } from "./base.service";
import { profileService } from "./profile.service";
import { eq, and, asc } from "drizzle-orm";
import { exerciseService } from "./exercise.service";
import {
  buildClaudePrompt,
  buildClaudeDailyPrompt,
  buildClaudeChunkedPrompt,
} from "@/utils/prompt-generator";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/utils/logger";
import {
  retryWithBackoff,
  CHUNKED_GENERATION_RETRY_OPTIONS,
  DEFAULT_API_RETRY_OPTIONS,
} from "@/utils/retry.utils";
import { emitProgress } from "@/utils/websocket-progress.utils";
import { WorkoutAgentService } from "./workout-agent.service";

// Utility function to clean JSON responses that may be wrapped in code blocks
function cleanJsonResponse(response: string): string {
  const original = response.trim();

  // Remove markdown code blocks if present
  const jsonBlockPattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = original.match(jsonBlockPattern);

  if (match) {
    const cleaned = match[1].trim();
    logger.debug("Cleaned JSON code block", {
      operation: "cleanJsonResponse",
      metadata: {
        originalLength: original.length,
        cleanedLength: cleaned.length,
        hadCodeBlock: true,
        originalPreview:
          original.substring(0, 100) + (original.length > 100 ? "..." : ""),
        cleanedPreview:
          cleaned.substring(0, 100) + (cleaned.length > 100 ? "..." : ""),
      },
    });
    return cleaned;
  }

  // Return original response if no code block found
  logger.debug("No code block found in response", {
    operation: "cleanJsonResponse",
    metadata: {
      responseLength: original.length,
      hadCodeBlock: false,
      preview:
        original.substring(0, 100) + (original.length > 100 ? "..." : ""),
    },
  });
  return original;
}

export class PromptsService extends BaseService {
  private workoutAgent: WorkoutAgentService;

  constructor() {
    super();
    this.workoutAgent = new WorkoutAgentService();
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

  public async generatePrompt(userId: number, customFeedback?: string, threadId?: string) {
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

    const exercises = await exerciseService.getExercises();
    const exerciseNames = exercises.map((exercise) => exercise.name);

    if (threadId && customFeedback) {
      // Use agent for weekly generation with feedback and conversation memory
      try {
        const workout = await this.workoutAgent.regenerateWorkout(
          userId,
          profile,
          exerciseNames,
          threadId,
          customFeedback
        );

        const createdPrompt = await this.createPrompt({
          userId,
          prompt: customFeedback || "Generate weekly workout",
          response: JSON.stringify(workout),
          threadId
        });

        return { response: workout, promptId: createdPrompt.id };
      } catch (error) {
        logger.warn("Agent failed for weekly generation, falling back to traditional generation", {
          error: (error as Error).message,
          userId,
          threadId,
          operation: "generatePrompt"
        });
        // Fall through to existing implementation
      }
    }

    const prompt = buildClaudePrompt(profile, exerciseNames, customFeedback);
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    let attempts = 0;
    const maxAttempts = 3;
    let data;
    let parsedResponse;

    while (attempts < maxAttempts) {
      try {
        const { data: result, response } = await retryWithBackoff(
          async () => {
            const response = await anthropic.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 8192,
              messages: [
                { role: "user" as const, content: prompt },
                ...(attempts > 0
                  ? [
                      {
                        role: "user" as const,
                        content: `You have only generated the workout plan for ${parsedResponse?.workoutPlan?.length || 1} days. You MUST generate it for all ${profile.availableDays?.length || 7} days. Please regenerate the COMPLETE weekly workout plan.`,
                      },
                    ]
                  : []),
              ],
            });
            return {
              data: (response.content[0] as any).text,
              response: response,
            };
          },
          DEFAULT_API_RETRY_OPTIONS,
          {
            operation: "generatePrompt",
            userId,
          }
        );
        data = result;

        // Log raw response for debugging
        logger.debug("Raw AI response received", {
          userId,
          operation: "generatePrompt",
          metadata: {
            responseLength: data.length,
            stopReason: response.stop_reason,
            attempt: attempts + 1,
            preview: data.substring(0, 200) + (data.length > 200 ? "..." : ""),
          },
        });

        // Check if response was truncated or approaching limit
        if (response.stop_reason === "max_tokens") {
          logger.error("AI response truncated due to token limit", undefined, {
            userId,
            operation: "generatePrompt",
            metadata: { responseLength: data.length },
          });
          throw new Error(
            "AI response was truncated. Please try regenerating with a shorter request."
          );
        }

        // Warn if approaching token limit
        if (data.length > 7000) {
          logger.warn("AI response approaching token limit", {
            userId,
            operation: "generatePrompt",
            metadata: { responseLength: data.length },
          });
        }

        try {
          parsedResponse = JSON.parse(cleanJsonResponse(data));

          // Log parsed response structure for debugging
          logger.debug("Parsed AI response structure", {
            userId,
            operation: "generatePrompt",
            metadata: {
              hasWorkoutPlan: !!parsedResponse.workoutPlan,
              workoutPlanLength: parsedResponse.workoutPlan?.length,
              hasExercisesToAdd: !!parsedResponse.exercisesToAdd,
              exercisesToAddLength: parsedResponse.exercisesToAdd?.length,
              responseKeys: Object.keys(parsedResponse),
              sampleDay: parsedResponse.workoutPlan?.[0]
                ? {
                    dayKeys: Object.keys(parsedResponse.workoutPlan[0]),
                    hasBlocks: !!parsedResponse.workoutPlan[0].blocks,
                    blocksLength: parsedResponse.workoutPlan[0].blocks?.length,
                  }
                : null,
            },
          });

          if (
            parsedResponse.workoutPlan?.length ===
            (profile.availableDays?.length || 7)
          ) {
            logger.info("Workout plan generated successfully", {
              userId,
              operation: "generatePrompt",
              metadata: {
                daysGenerated: parsedResponse.workoutPlan?.length,
                expectedDays: profile.availableDays?.length || 7,
              },
            });
            break;
          }

          logger.warn("AI generated incorrect number of days, retrying", {
            userId,
            operation: "generatePrompt",
            metadata: {
              daysGenerated: parsedResponse.workoutPlan?.length,
              expectedDays: profile.availableDays?.length || 7,
              attempt: attempts + 1,
              maxAttempts,
            },
          });
        } catch (parseError: any) {
          logger.error("Failed to parse AI response as JSON", parseError, {
            userId,
            operation: "generatePrompt",
            metadata: {
              responseLength: data.length,
              rawResponse: data.substring(0, 500),
            },
          });

          throw new Error(
            `Failed to parse AI response as JSON: ${parseError.message}`
          );
        }
      } catch (apiError: any) {
        logger.error("AI API error during prompt generation", apiError, {
          userId,
          operation: "generatePrompt",
        });
        throw new Error(`Failed to generate workout plan: ${apiError.message}`);
      }

      attempts++;
    }

    if (attempts === maxAttempts) {
      throw new Error(
        `Failed to generate correct number of days after ${maxAttempts} attempts`
      );
    }

    const createdPrompt = await this.createPrompt({
      userId,
      prompt,
      response: data,
    });

    return { response: parsedResponse, promptId: createdPrompt.id };
  }

  public async generateChunkedPrompt(userId: number, customFeedback?: string) {
    // Emit 12% - Loading user profile
    emitProgress(userId, 12);

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

    // Emit 13% - Loading exercise database
    emitProgress(userId, 13);

    const exercises = await exerciseService.getExercises();
    const exerciseNames = exercises.map((exercise) => exercise.name);
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const totalDays = profile.availableDays?.length || 7;
    const chunkSize = 2; // Generate 2 days at a time
    const totalChunks = Math.ceil(totalDays / chunkSize);

    logger.info("Starting chunked workout generation", {
      userId,
      operation: "generateChunkedPrompt",
      metadata: { totalDays, totalChunks, chunkSize },
    });

    let allWorkoutDays: any[] = [];
    let allExercisesToAdd: any[] = [];
    let workoutName = "";
    let workoutDescription = "";

    // Emit 15% - LLM API request starting
    emitProgress(userId, 15);

    // Start gradual progress timer while waiting for first chunk
    let currentWaitingProgress = 15;
    const waitingInterval = setInterval(() => {
      if (currentWaitingProgress < 25) {
        currentWaitingProgress += 2;
        emitProgress(userId, Math.min(currentWaitingProgress, 25));
      } else {
        clearInterval(waitingInterval);
      }
    }, 1000); // Increment 2% every second

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      // Clear waiting timer when first chunk starts
      if (chunkIndex === 0) {
        clearInterval(waitingInterval);
      }
      const startDay = chunkIndex * chunkSize + 1;
      const endDay = Math.min(startDay + chunkSize - 1, totalDays);
      const chunkNumber = chunkIndex + 1;

      // Calculate progress percentage (25% to 90% for n-1 chunks, final chunk gets 90%)
      const progressPercentage =
        chunkIndex < totalChunks - 1
          ? 25 + Math.round((chunkIndex / (totalChunks - 1)) * 65) // 25% to 90% for first n-1 chunks
          : 90; // Final chunk stays at 90%, remaining 10% for database operations
      emitProgress(userId, progressPercentage);

      logger.debug("Generating chunk", {
        userId,
        operation: "generateChunkedPrompt",
        metadata: { chunkNumber, totalChunks, startDay, endDay },
      });

      const prompt = buildClaudeChunkedPrompt(
        profile,
        exerciseNames,
        chunkNumber,
        totalChunks,
        startDay,
        endDay,
        customFeedback
      );

      try {
        const { response, data } = await retryWithBackoff(
          async () => {
            const response = await anthropic.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 8192,
              messages: [{ role: "user" as const, content: prompt }],
            });

            const data = (response.content[0] as any).text;
            return { response, data };
          },
          CHUNKED_GENERATION_RETRY_OPTIONS,
          {
            operation: "generateChunkedPrompt",
            userId,
          }
        );

        // Log raw chunk response for debugging
        logger.debug("Raw AI chunk response received", {
          userId,
          operation: "generateChunkedPrompt",
          metadata: {
            chunkNumber,
            responseLength: data.length,
            stopReason: response.stop_reason,
            preview: data.substring(0, 200) + (data.length > 200 ? "..." : ""),
          },
        });

        // Check if response was truncated
        if (response.stop_reason === "max_tokens") {
          logger.error(
            "Chunk response truncated due to token limit",
            undefined,
            {
              userId,
              operation: "generateChunkedPrompt",
              metadata: { chunkNumber },
            }
          );
          throw new Error(
            `Chunk ${chunkNumber} response was truncated. Please try again.`
          );
        }

        let parsedResponse;
        try {
          parsedResponse = JSON.parse(cleanJsonResponse(data));

          // Log parsed chunk structure for debugging
          logger.debug("Parsed AI chunk response structure", {
            userId,
            operation: "generateChunkedPrompt",
            metadata: {
              chunkNumber,
              hasWorkoutPlan: !!parsedResponse.workoutPlan,
              workoutPlanLength: parsedResponse.workoutPlan?.length,
              hasExercisesToAdd: !!parsedResponse.exercisesToAdd,
              responseKeys: Object.keys(parsedResponse),
              sampleDay: parsedResponse.workoutPlan?.[0]
                ? {
                    dayKeys: Object.keys(parsedResponse.workoutPlan[0]),
                    hasBlocks: !!parsedResponse.workoutPlan[0].blocks,
                    blocksLength: parsedResponse.workoutPlan[0].blocks?.length,
                  }
                : null,
            },
          });
        } catch (parseError: any) {
          logger.error("Failed to parse chunk response as JSON", parseError, {
            userId,
            operation: "generateChunkedPrompt",
            metadata: { chunkNumber, rawResponse: data.substring(0, 500) },
          });
          throw new Error(
            `Failed to parse chunk ${chunkNumber} response as JSON: ${parseError.message}`
          );
        }

        // Validate chunk structure
        if (
          !parsedResponse.workoutPlan ||
          !Array.isArray(parsedResponse.workoutPlan)
        ) {
          throw new Error(
            `Chunk ${chunkNumber} missing valid workoutPlan array`
          );
        }

        const expectedDaysInChunk = endDay - startDay + 1;
        if (parsedResponse.workoutPlan.length !== expectedDaysInChunk) {
          throw new Error(
            `Chunk ${chunkNumber} generated ${parsedResponse.workoutPlan.length} days, expected ${expectedDaysInChunk}`
          );
        }

        // Store name and description from first chunk
        if (chunkIndex === 0) {
          workoutName = parsedResponse.name || "Custom Workout Plan";
          workoutDescription =
            parsedResponse.description || "Comprehensive weekly workout plan";
        }

        // Accumulate workout days
        allWorkoutDays.push(...parsedResponse.workoutPlan);

        // Accumulate exercises to add
        if (
          parsedResponse.exercisesToAdd &&
          Array.isArray(parsedResponse.exercisesToAdd)
        ) {
          allExercisesToAdd.push(...parsedResponse.exercisesToAdd);
        }

        // Add a small delay between chunks to avoid rate limiting
        if (chunkIndex < totalChunks - 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch (error: any) {
        logger.error("Error generating chunk", error, {
          userId,
          operation: "generateChunkedPrompt",
          metadata: { chunkNumber },
        });
        throw new Error(
          `Failed to generate chunk ${chunkNumber}: ${error.message}`
        );
      }
    }

    // Combine all chunks into final response
    const finalResponse = {
      name: workoutName,
      description: workoutDescription,
      workoutPlan: allWorkoutDays,
      exercisesToAdd: allExercisesToAdd,
    };

    // Emit 95% - AI generation complete
    emitProgress(userId, 95);

    logger.info("Complete workout plan generated successfully", {
      userId,
      operation: "generateChunkedPrompt",
      metadata: { totalDays: allWorkoutDays.length },
    });

    // Create a single prompt record for the entire generation
    const combinedPromptText = `CHUNKED GENERATION: ${totalChunks} chunks for ${totalDays} days`;
    const createdPrompt = await this.createPrompt({
      userId,
      prompt: combinedPromptText,
      response: JSON.stringify(finalResponse),
    });

    // Emit 99% - Database operations complete
    emitProgress(userId, 99);

    return { response: finalResponse, promptId: createdPrompt.id };
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
    }
  ) {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

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

    const exercises = await exerciseService.getExercises();
    const exerciseNames = exercises.map((exercise) => exercise.name);

    // Build prompt with custom feedback
    const basePrompt = buildClaudePrompt(updatedProfile, exerciseNames);
    const customFeedbackSection = regenerationData.customFeedback
      ? `\n\n**IMPORTANT CUSTOM FEEDBACK FROM USER:**\n${regenerationData.customFeedback}\n\nPlease incorporate this feedback into the workout plan generation.`
      : "";

    const prompt = basePrompt + customFeedbackSection;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    let attempts = 0;
    const maxAttempts = 3;
    let data;
    let parsedResponse;

    while (attempts < maxAttempts) {
      try {
        const { data: result, response } = await retryWithBackoff(
          async () => {
            const response = await anthropic.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 8192,
              messages: [
                { role: "user" as const, content: prompt },
                ...(attempts > 0
                  ? [
                      {
                        role: "user" as const,
                        content: `You have only generated the workout plan for ${parsedResponse?.workoutPlan?.length || 1} days. You MUST generate it for all ${updatedProfile.availableDays?.length || 7} days. Please regenerate the COMPLETE weekly workout plan.`,
                      },
                    ]
                  : []),
              ],
            });
            return {
              data: (response.content[0] as any).text,
              response: response,
            };
          },
          DEFAULT_API_RETRY_OPTIONS,
          {
            operation: "generateRegenerationPrompt",
            userId,
          }
        );
        data = result;
      } catch (retryError) {
        logger.error(
          "Failed to generate regeneration prompt after retries",
          retryError as Error,
          {
            userId,
            operation: "generateRegenerationPrompt",
            metadata: { attempts },
          }
        );
        throw retryError;
      }

      // Log raw regeneration response for debugging
      logger.debug("Raw AI regeneration response received", {
        userId,
        operation: "generateRegenerationPrompt",
        metadata: {
          responseLength: data.length,
          stopReason: response.stop_reason,
          attempt: attempts + 1,
          preview: data.substring(0, 200) + (data.length > 200 ? "..." : ""),
        },
      });

      // Check if response was truncated or approaching limit
      if (response.stop_reason === "max_tokens") {
        logger.error(
          "AI regeneration response truncated due to token limit",
          undefined,
          {
            userId,
            operation: "generateRegenerationPrompt",
            metadata: { responseLength: data.length },
          }
        );
        throw new Error(
          "AI response was truncated. Please try regenerating with shorter feedback."
        );
      }

      // Warn if approaching token limit
      if (data.length > 7000) {
        logger.warn("AI regeneration response approaching token limit", {
          userId,
          operation: "generateRegenerationPrompt",
          metadata: { responseLength: data.length },
        });
      }

      try {
        parsedResponse = JSON.parse(cleanJsonResponse(data));

        // Log parsed regeneration response structure for debugging
        logger.debug("Parsed AI regeneration response structure", {
          userId,
          operation: "generateRegenerationPrompt",
          metadata: {
            hasWorkoutPlan: !!parsedResponse.workoutPlan,
            workoutPlanLength: parsedResponse.workoutPlan?.length,
            hasExercisesToAdd: !!parsedResponse.exercisesToAdd,
            responseKeys: Object.keys(parsedResponse),
            sampleDay: parsedResponse.workoutPlan?.[0]
              ? {
                  dayKeys: Object.keys(parsedResponse.workoutPlan[0]),
                  hasBlocks: !!parsedResponse.workoutPlan[0].blocks,
                  blocksLength: parsedResponse.workoutPlan[0].blocks?.length,
                }
              : null,
          },
        });

        // Validate number of days
        if (
          parsedResponse.workoutPlan?.length ===
          (updatedProfile.availableDays?.length || 7)
        ) {
          break; // Valid response, exit loop
        }
        logger.warn("AI generated incorrect number of days, retrying", {
          userId,
          operation: "generateRegenerationPrompt",
          metadata: {
            daysGenerated: parsedResponse.workoutPlan?.length,
            expectedDays: updatedProfile.availableDays?.length || 7,
            attempt: attempts + 1,
            maxAttempts,
          },
        });
      } catch (parseError: any) {
        logger.error(
          "Failed to parse AI regeneration response as JSON",
          parseError,
          {
            userId,
            operation: "generateRegenerationPrompt",
            metadata: {
              responseLength: data.length,
              rawResponse: data.substring(0, 500),
            },
          }
        );
        throw new Error(
          `Failed to parse AI response as JSON: ${parseError.message}`
        );
      }

      attempts++;
    }

    if (attempts === maxAttempts) {
      throw new Error(
        `Failed to generate correct number of days after ${maxAttempts} attempts`
      );
    }

    const createdPrompt = await this.createPrompt({
      userId,
      prompt,
      response: data,
    });

    return { response: parsedResponse, promptId: createdPrompt.id };
  }

  public async generateDailyRegenerationPrompt(
    userId: number,
    dayNumber: number,
    previousWorkout: any,
    regenerationReason: string,
    isRestDay: boolean = false,
    threadId?: string
  ) {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    const exercises = await exerciseService.getExercises();
    const exerciseNames = exercises.map((exercise) => exercise.name);

    if (threadId) {
      // Use agent for daily regeneration with conversation memory
      try {
        const workout = await this.workoutAgent.regenerateWorkout(
          userId,
          profile,
          exerciseNames,
          threadId,
          regenerationReason,
          dayNumber,
          isRestDay
        );

        const createdPrompt = await this.createPrompt({
          userId,
          prompt: regenerationReason,
          response: JSON.stringify(workout),
          threadId
        });

        return { response: workout, promptId: createdPrompt.id };
      } catch (error) {
        logger.warn("Agent failed for daily regeneration, falling back to traditional generation", {
          error: (error as Error).message,
          userId,
          threadId,
          dayNumber,
          operation: "generateDailyRegenerationPrompt"
        });
        // Fall through to existing implementation
      }
    }

    const prompt = buildClaudeDailyPrompt(
      profile,
      exerciseNames,
      dayNumber,
      previousWorkout,
      regenerationReason,
      isRestDay
    );

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const { data, response } = await retryWithBackoff(
      async () => {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          messages: [{ role: "user" as const, content: prompt }],
        });
        return {
          data: (response.content[0] as any).text,
          response: response,
        };
      },
      DEFAULT_API_RETRY_OPTIONS,
      {
        operation: "generateDailyRegenerationPrompt",
        userId,
      }
    );

    // Log raw daily regeneration response for debugging
    logger.debug("Raw AI daily regeneration response received", {
      userId,
      operation: "generateDailyRegenerationPrompt",
      metadata: {
        dayNumber,
        responseLength: data.length,
        stopReason: response.stop_reason,
        preview: data.substring(0, 200) + (data.length > 200 ? "..." : ""),
      },
    });

    // Check if response was truncated or approaching limit
    if (response.stop_reason === "max_tokens") {
      logger.error(
        "AI daily regeneration response truncated due to token limit",
        undefined,
        {
          userId,
          operation: "generateDailyRegenerationPrompt",
          metadata: { responseLength: data.length, dayNumber },
        }
      );
      throw new Error(
        "AI response was truncated. Please try regenerating with shorter feedback."
      );
    }

    // Warn if approaching token limit
    if (data.length > 7000) {
      logger.warn("AI daily regeneration response approaching token limit", {
        userId,
        operation: "generateDailyRegenerationPrompt",
        metadata: { responseLength: data.length, dayNumber },
      });
    }

    const createdPrompt = await this.createPrompt({
      userId,
      prompt,
      response: data,
    });

    try {
      const parsedResponse = JSON.parse(cleanJsonResponse(data));

      // Log parsed daily regeneration response structure for debugging
      logger.debug("Parsed AI daily regeneration response structure", {
        userId,
        operation: "generateDailyRegenerationPrompt",
        metadata: {
          dayNumber,
          responseKeys: Object.keys(parsedResponse),
          hasBlocks: !!parsedResponse.blocks,
          blocksLength: parsedResponse.blocks?.length,
          hasExercises: !!parsedResponse.exercises,
          exercisesLength: parsedResponse.exercises?.length,
          hasName: !!parsedResponse.name,
          hasDescription: !!parsedResponse.description,
          sampleBlock: parsedResponse.blocks?.[0]
            ? {
                blockKeys: Object.keys(parsedResponse.blocks[0]),
                hasExercises: !!parsedResponse.blocks[0].exercises,
                exercisesLength: parsedResponse.blocks[0].exercises?.length,
                sampleExercise: parsedResponse.blocks[0].exercises?.[0]
                  ? Object.keys(parsedResponse.blocks[0].exercises[0])
                  : null,
              }
            : null,
        },
      });

      // Emit 95% - AI response received and parsed
      emitProgress(userId, 95);

      return { response: parsedResponse, promptId: createdPrompt.id };
    } catch (parseError: any) {
      logger.error(
        "Failed to parse AI daily regeneration response as JSON",
        parseError,
        {
          userId,
          operation: "generateDailyRegenerationPrompt",
          metadata: {
            responseLength: data.length,
            dayNumber,
            rawResponse: data.substring(0, 500),
          },
        }
      );
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`
      );
    }
  }
}

export const promptsService = new PromptsService();

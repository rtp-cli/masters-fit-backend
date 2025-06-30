import { InsertPrompt, Prompt, prompts } from "@/models";
import { BaseService } from "./base.service";
import { profileService } from "./profile.service";
import { eq } from "drizzle-orm";
import { exerciseService } from "./exercise.service";
import {
  buildClaudePrompt,
  buildClaudeDailyPrompt,
  buildClaudeChunkedPrompt,
} from "@/utils/prompt-generator";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/utils/logger";

export class PromptsService extends BaseService {
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

  public async generatePrompt(userId: number, customFeedback?: string) {
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
        const response = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
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
        data = (response.content[0] as any).text;

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
          parsedResponse = JSON.parse(data);
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
            metadata: { responseLength: data.length },
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

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startDay = chunkIndex * chunkSize + 1;
      const endDay = Math.min(startDay + chunkSize - 1, totalDays);
      const chunkNumber = chunkIndex + 1;

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
        const response = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 8192,
          messages: [{ role: "user" as const, content: prompt }],
        });

        const data = (response.content[0] as any).text;

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
          parsedResponse = JSON.parse(data);
        } catch (parseError: any) {
          logger.error("Failed to parse chunk response as JSON", parseError, {
            userId,
            operation: "generateChunkedPrompt",
            metadata: { chunkNumber },
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
          await new Promise((resolve) => setTimeout(resolve, 1000));
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
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
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
      data = (response.content[0] as any).text;

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
        parsedResponse = JSON.parse(data);
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
            metadata: { responseLength: data.length },
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
    regenerationReason: string
  ) {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    const exercises = await exerciseService.getExercises();
    const exerciseNames = exercises.map((exercise) => exercise.name);

    const prompt = buildClaudeDailyPrompt(
      profile,
      exerciseNames,
      dayNumber,
      previousWorkout,
      regenerationReason
    );

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      messages: [{ role: "user" as const, content: prompt }],
    });
    const data = (response.content[0] as any).text;

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
      const parsedResponse = JSON.parse(data);
      return { response: parsedResponse, promptId: createdPrompt.id };
    } catch (parseError: any) {
      logger.error(
        "Failed to parse AI daily regeneration response as JSON",
        parseError,
        {
          userId,
          operation: "generateDailyRegenerationPrompt",
          metadata: { responseLength: data.length, dayNumber },
        }
      );
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`
      );
    }
  }
}

export const promptsService = new PromptsService();

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
      console.log(`Attempt ${attempts + 1} to generate workout plan`);

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
          console.error(
            "❌ AI response was truncated due to token limit. This will likely cause JSON parsing errors."
          );
          console.error("Response length:", data.length);
          console.error("Last 200 characters:", data.slice(-200));
          throw new Error(
            "AI response was truncated. Please try regenerating with a shorter request."
          );
        }

        // Warn if approaching token limit (>90% of response length suggests near-limit)
        if (data.length > 7000) {
          console.warn(
            "⚠️ AI response is quite long. Consider optimizing prompt for efficiency."
          );
          console.warn("Response length:", data.length);
        }

        try {
          parsedResponse = JSON.parse(data);

          // Log the parsed response structure
          console.log("Parsed response structure:", {
            hasWorkoutPlan: !!parsedResponse.workoutPlan,
            workoutPlanLength: parsedResponse.workoutPlan?.length,
            expectedDays: profile.availableDays?.length || 7,
            firstDayBlocks: parsedResponse.workoutPlan?.[0]?.blocks?.length,
          });

          // Validate number of days
          if (
            parsedResponse.workoutPlan?.length ===
            (profile.availableDays?.length || 7)
          ) {
            console.log(
              "✅ Successfully generated workout plan with correct number of days"
            );
            break; // Valid response, exit loop
          }

          console.warn(
            `AI generated ${parsedResponse.workoutPlan?.length} days instead of ${profile.availableDays?.length || 7} days. Attempt ${attempts + 1}/${maxAttempts}`
          );

          // Log the first day's structure if available
          if (parsedResponse.workoutPlan?.[0]) {
            console.log("First day structure:", {
              name: parsedResponse.workoutPlan[0].name,
              blockCount: parsedResponse.workoutPlan[0].blocks?.length,
              exerciseCount: parsedResponse.workoutPlan[0].blocks?.reduce(
                (total: number, block: any) =>
                  total + (block.exercises?.length || 0),
                0
              ),
            });
          }
        } catch (parseError: any) {
          console.error("JSON Parse Error:", parseError.message);
          console.error("Raw response length:", data.length);
          console.error("Response ends with:", data.slice(-100));

          // Try to find where the JSON structure breaks
          const lastBracketIndex = data.lastIndexOf("}");
          const lastSquareBracketIndex = data.lastIndexOf("]");
          console.error("Last closing brackets at:", {
            curly: lastBracketIndex,
            square: lastSquareBracketIndex,
          });

          throw new Error(
            `Failed to parse AI response as JSON: ${parseError.message}`
          );
        }
      } catch (apiError: any) {
        console.error("API Error:", apiError.message);
        throw new Error(`Failed to generate workout plan: ${apiError.message}`);
      }

      attempts++;
    }

    if (attempts === maxAttempts) {
      throw new Error(
        `Failed to generate correct number of days after ${maxAttempts} attempts`
      );
    }

    // Log response for debugging
    console.log("AI Response length:", data.length);

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

    console.log(
      `Generating ${totalDays} days in ${totalChunks} chunks of ${chunkSize} days each`
    );

    let allWorkoutDays: any[] = [];
    let allExercisesToAdd: any[] = [];
    let workoutName = "";
    let workoutDescription = "";

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startDay = chunkIndex * chunkSize + 1;
      const endDay = Math.min(startDay + chunkSize - 1, totalDays);
      const chunkNumber = chunkIndex + 1;

      console.log(
        `Generating chunk ${chunkNumber}/${totalChunks}: days ${startDay} to ${endDay}`
      );

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
          console.error(
            `❌ Chunk ${chunkNumber} response was truncated due to token limit.`
          );
          throw new Error(
            `Chunk ${chunkNumber} response was truncated. Please try again.`
          );
        }

        let parsedResponse;
        try {
          parsedResponse = JSON.parse(data);
        } catch (parseError: any) {
          console.error(
            `JSON Parse Error for chunk ${chunkNumber}:`,
            parseError.message
          );
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

        console.log(
          `✅ Successfully generated chunk ${chunkNumber} with ${parsedResponse.workoutPlan.length} days`
        );

        // Add a small delay between chunks to avoid rate limiting
        if (chunkIndex < totalChunks - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error: any) {
        console.error(`Error generating chunk ${chunkNumber}:`, error.message);
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

    console.log(
      `✅ Successfully generated complete workout plan with ${allWorkoutDays.length} days`
    );

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
        console.error(
          "❌ AI regeneration response was truncated due to token limit."
        );
        console.error("Response length:", data.length);
        console.error("Last 200 characters:", data.slice(-200));
        throw new Error(
          "AI response was truncated. Please try regenerating with shorter feedback."
        );
      }

      // Warn if approaching token limit
      if (data.length > 7000) {
        console.warn("⚠️ AI regeneration response is quite long.");
        console.warn("Response length:", data.length);
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
        console.warn(
          `AI generated ${parsedResponse.workoutPlan?.length} days instead of ${updatedProfile.availableDays?.length || 7} days. Attempt ${attempts + 1}/${maxAttempts}`
        );
      } catch (parseError: any) {
        console.error("JSON Parse Error in regeneration:", parseError.message);
        console.error("Raw response length:", data.length);
        console.error("Response ends with:", data.slice(-100));
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

    // Log response for debugging
    console.log("AI Regeneration Response length:", data.length);

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
      console.error(
        "❌ AI daily regeneration response was truncated due to token limit."
      );
      console.error("Response length:", data.length);
      console.error("Last 200 characters:", data.slice(-200));
      throw new Error(
        "AI response was truncated. Please try regenerating with shorter feedback."
      );
    }

    // Warn if approaching token limit
    if (data.length > 7000) {
      console.warn("⚠️ AI daily regeneration response is quite long.");
      console.warn("Response length:", data.length);
    }

    // Log response for debugging
    console.log("AI Daily Regeneration Response length:", data.length);
    console.log("Stop reason:", response.stop_reason);

    const createdPrompt = await this.createPrompt({
      userId,
      prompt,
      response: data,
    });

    try {
      const parsedResponse = JSON.parse(data);
      return { response: parsedResponse, promptId: createdPrompt.id };
    } catch (parseError: any) {
      console.error(
        "JSON Parse Error in daily regeneration:",
        parseError.message
      );
      console.error("Raw response length:", data.length);
      console.error("Response ends with:", data.slice(-100));
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`
      );
    }
  }
}

export const promptsService = new PromptsService();

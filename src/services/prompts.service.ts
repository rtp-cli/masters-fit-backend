import { InsertPrompt, Prompt, prompts } from "@/models";
import { BaseService } from "./base.service";
import { profileService } from "./profile.service";
import { eq } from "drizzle-orm";
import { exerciseService } from "./exercise.service";
import {
  buildClaudePrompt,
  buildClaudeDailyPrompt,
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
    const exercises = await exerciseService.getExercises();
    const exerciseNames = exercises.map((exercise) => exercise.name);
    const prompt = buildClaudePrompt(profile, exerciseNames, customFeedback);
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const data = (response.content[0] as any).text;

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

    // Log response for debugging
    console.log("AI Response length:", data.length);
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
      console.error("JSON Parse Error:", parseError.message);
      console.error("Raw response length:", data.length);
      console.error("Response ends with:", data.slice(-100));
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`
      );
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
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const data = (response.content[0] as any).text;

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

    // Log response for debugging
    console.log("AI Regeneration Response length:", data.length);
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
      console.error("JSON Parse Error in regeneration:", parseError.message);
      console.error("Raw response length:", data.length);
      console.error("Response ends with:", data.slice(-100));
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`
      );
    }
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
      messages: [{ role: "user", content: prompt }],
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

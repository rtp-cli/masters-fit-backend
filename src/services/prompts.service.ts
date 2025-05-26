import { InsertPrompt, Prompt, prompts } from "@/models";
import { BaseService } from "./base.service";
import { profileService } from "./profile.service";
import { eq } from "drizzle-orm";
import { exerciseService } from "./exercise.service";
import { buildClaudePrompt } from "@/utils/prompt-generator";
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

  public async generatePrompt(userId: number) {
    const profile = await profileService.getProfileByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }
    const exercises = await exerciseService.getExercises();
    const exerciseNames = exercises.map((exercise) => exercise.name);
    const prompt = buildClaudePrompt(profile, exerciseNames);
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const data = response.content[0].text;
    const createdPrompt = await this.createPrompt({
      userId,
      prompt,
      response: data,
    });
    return { response: JSON.parse(data), promptId: createdPrompt.id };
  }
}

export const promptsService = new PromptsService();

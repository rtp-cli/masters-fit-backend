import { Exercise, exercises, InsertExercise } from "@/models";
import { BaseService } from "./base.service";
import { eq, ilike } from "drizzle-orm";

export class ExerciseService extends BaseService {
  async createExercise(data: InsertExercise) {
    const result = await this.db
      .insert(exercises)
      .values([
        {
          name: data.name,
          muscleGroups: data.muscleGroups,
          instructions: Array.isArray(data.instructions)
            ? data.instructions.join("\n")
            : data.instructions,
          equipment: data.equipment,
          description: data.description,
          difficulty: data.difficulty,
          tag: data.tag,
        },
      ])
      .returning();
    return result[0];
  }

  async getExerciseById(id: number) {
    const result = await this.db.query.exercises.findFirst({
      where: eq(exercises.id, id),
    });

    return result;
  }

  async getExercises(): Promise<Exercise[]> {
    const result = await this.db.query.exercises.findMany();
    return result;
  }

  async updateExercise(id: number, data: InsertExercise) {
    // Convert instructions array to string if needed
    const updateData = {
      ...data,
      instructions: Array.isArray(data.instructions)
        ? data.instructions.join("\n")
        : data.instructions,
    };

    const result = await this.db
      .update(exercises)
      .set(updateData)
      .where(eq(exercises.id, id))
      .returning();

    return result[0];
  }

  async deleteExercise(id: number) {
    await this.db.delete(exercises).where(eq(exercises.id, id));
  }

  async getExerciseByName(name: string) {
    const result = await this.db.query.exercises.findFirst({
      where: ilike(exercises.name, `%${name}%`),
    });

    return result;
  }

  async updateExerciseLink(id: number, link: string | null) {
    const result = await this.db
      .update(exercises)
      .set({ link })
      .where(eq(exercises.id, id))
      .returning();

    return result[0];
  }
}

export const exerciseService = new ExerciseService();

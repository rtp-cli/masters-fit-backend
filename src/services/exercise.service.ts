import { Exercise, exercises, InsertExercise } from "@/models";
import { BaseService } from "./base.service";
import { eq, ilike } from "drizzle-orm";
import { logger } from "@/utils/logger";

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
          link: data.link,
        },
      ])
      .returning();
    return result[0];
  }

  async createExerciseIfNotExists(data: InsertExercise) {
    // First check if exercise with this name already exists
    const existing = await this.getExerciseByName(data.name);
    if (existing) {
      logger.debug(
        `Exercise "${data.name}" already exists with ID ${existing.id}, skipping creation`,
        {
          operation: "createExerciseIfNotExists",
          metadata: { exerciseName: data.name, existingId: existing.id },
        }
      );
      return existing;
    }

    // If not found, create new exercise
    return await this.createExercise(data);
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

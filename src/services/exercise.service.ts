import { Exercise, exercises, InsertExercise } from "@/models";
import { BaseService } from "./base.service";
import { eq, ilike, and, arrayOverlaps, inArray, or, isNull } from "drizzle-orm";
import { logger } from "@/utils/logger";

// Interface for exercise metadata (minimal data for LLM)
export interface ExerciseMetadata {
  name: string;
  equipment: string[] | null;
  muscleGroups: string[];
  difficulty: string | null;
}

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

  async searchExercises(filters: {
    muscleGroups?: string[];
    equipment?: string[];
    difficulty?: string[];
    styles?: string[];
    limit?: number;
  }): Promise<ExerciseMetadata[]> {
    try {
      let query = this.db
        .select({
          name: exercises.name,
          equipment: exercises.equipment,
          muscleGroups: exercises.muscleGroups,
          difficulty: exercises.difficulty,
        })
        .from(exercises);

      const conditions = [];

      // Filter by muscle groups (if any muscle group overlaps)
      if (filters.muscleGroups && filters.muscleGroups.length > 0) {
        conditions.push(arrayOverlaps(exercises.muscleGroups, filters.muscleGroups));
      }

      // Filter by equipment with strict enforcement
      if (filters.equipment && filters.equipment.length > 0) {
        // Check if this is a bodyweight-only request
        const isBodyweightOnly = filters.equipment.length === 1 &&
          (filters.equipment[0].toLowerCase().includes('bodyweight') ||
           filters.equipment[0].toLowerCase().includes('none'));

        if (isBodyweightOnly) {
          // For bodyweight-only: include exercises with null, empty, or "bodyweight" equipment
          conditions.push(
            or(
              isNull(exercises.equipment),
              eq(exercises.equipment, []),
              arrayOverlaps(exercises.equipment, ["bodyweight"])
            )
          );
        } else {
          // For specific equipment: include exercises that use ANY of the specified equipment
          // AND also include bodyweight exercises as alternatives
          conditions.push(
            or(
              arrayOverlaps(exercises.equipment, filters.equipment as any),
              isNull(exercises.equipment),
              eq(exercises.equipment, [])
            )
          );
        }
      }

      // Filter by difficulty
      if (filters.difficulty && filters.difficulty.length > 0) {
        conditions.push(inArray(exercises.difficulty, filters.difficulty as any));
      }

      // Filter by styles (using tag field)
      if (filters.styles && filters.styles.length > 0) {
        conditions.push(inArray(exercises.tag, filters.styles));
      }

      // Apply all conditions
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      // Apply limit (default to 50)
      const limit = filters.limit || 50;
      const finalQuery = query.limit(limit);

      const result = await finalQuery;

      logger.info("Exercise search completed", {
        operation: "searchExercises",
        metadata: {
          filters,
          resultCount: result.length,
        }
      });

      return result as ExerciseMetadata[];
    } catch (error) {
      logger.error("Exercise search failed", error as Error, {
        operation: "searchExercises",
        metadata: { filters }
      });
      throw error;
    }
  }
}

export const exerciseService = new ExerciseService();

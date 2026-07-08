import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  AvailableEquipment as AvailableEquipmentEnum,
  IntensityLevels as IntensityLevelsEnum,
} from "@/constants/profile";
import { AvailableEquipment, IntensityLevel } from "@/types";

// Exercise table
export const exercises = pgTable(
  "exercises",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    equipment: text("equipment").array().$type<AvailableEquipment[]>(),
    muscleGroups: text("muscle_groups").array().notNull(),
    difficulty: text("difficulty").$type<IntensityLevel>(),
    instructions: text("instructions").notNull(),
    link: text("link"),
    tag: text("tag"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("idx_exercises_name").on(table.name),
    // [LR-056] Guards against the check-then-insert race in
    // createExerciseIfNotExists: concurrent fan-out day-generation calls could
    // both pass the "not found" check for the same new name and both insert.
    // Requires the catalog to be free of case-insensitive duplicates first —
    // see EXERCISE_CURATION_CANDIDATES_PROD.md / dedupe-exercises.ts.
    uniqueNameIdx: uniqueIndex("idx_exercises_name_unique").on(
      sql`lower(${table.name})`
    ),
    muscleGroupsIdx: index("idx_exercises_muscle_groups_gin").on(
      table.muscleGroups
    ),
    searchCompositeIdx: index("idx_exercises_search_composite").on(
      table.name,
      table.muscleGroups
    ),
  })
);

// Exercise schemas for validation
export const insertExerciseSchema = createInsertSchema(exercises, {
  name: z.string(),
  description: z.string().optional(),
  equipment: z.array(z.nativeEnum(AvailableEquipmentEnum)),
  muscleGroups: z.array(z.string()),
  difficulty: z.nativeEnum(IntensityLevelsEnum),
  instructions: z.string(),
  link: z.string().optional(),
  tag: z.string(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types - Explicit interface for TSOA compatibility
export interface Exercise {
  id: number;
  name: string;
  description: string | null;
  equipment: AvailableEquipment[] | null;
  muscleGroups: string[];
  difficulty: IntensityLevel | null;
  instructions: string;
  link: string | null;
  tag: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertExercise = z.infer<typeof insertExerciseSchema>;

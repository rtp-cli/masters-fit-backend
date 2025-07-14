import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  AvailableEquipment as AvailableEquipmentEnum,
  IntensityLevels as IntensityLevelsEnum,
} from "@/constants/profile";
import { AvailableEquipment, IntensityLevel } from "@/types";

// Exercise table
export const exercises = pgTable("exercises", {
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
}, (table) => ({
  nameIdx: index("idx_exercises_name").on(table.name),
  muscleGroupsIdx: index("idx_exercises_muscle_groups_gin").on(table.muscleGroups).using(sql`gin`),
  searchCompositeIdx: index("idx_exercises_search_composite").on(table.name, table.muscleGroups),
}));

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

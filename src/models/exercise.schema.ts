import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { planDayExercises } from "./workout.schema";
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Exercise schemas for validation
export const insertExerciseSchema = createInsertSchema(exercises, {
  name: z.string(),
  description: z.string().optional(),
  equipment: z.array(z.nativeEnum(AvailableEquipmentEnum)),
  muscleGroups: z.array(z.string()),
  difficulty: z.nativeEnum(IntensityLevelsEnum),
  instructions: z.array(z.string()),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Exercise = typeof exercises.$inferSelect;
export type InsertExercise = z.infer<typeof insertExerciseSchema>;

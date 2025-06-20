import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

import {
  FitnessGoal,
  PhysicalLimitation,
  FitnessLevel,
  WorkoutEnvironment,
  AvailableEquipment,
  PreferredStyles,
  PreferredDay,
  Gender,
  IntensityLevel,
} from "@/types/profile/types";
import {
  FitnessGoals as FitnessGoalsEnum,
  PhysicalLimitations as PhysicalLimitationsEnum,
  FitnessLevels as FitnessLevelsEnum,
  WorkoutEnvironments as WorkoutEnvironmentsEnum,
  AvailableEquipment as AvailableEquipmentEnum,
  PreferredStyles as PreferredStylesEnum,
  PreferredDays as PreferredDayEnum,
  IntensityLevels as IntensityLevelsEnum,
} from "@/constants/profile";
import { users } from "@/models/user.schema";

// User profile data table
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  age: integer("age"),
  height: integer("height"),
  weight: integer("weight"),
  gender: text("gender").$type<Gender>(),
  goals: text("goals").array().$type<FitnessGoal[]>(),
  limitations: text("limitations").array().$type<PhysicalLimitation[]>(),
  fitnessLevel: text("fitness_level").$type<FitnessLevel>(),
  environment: text("environment").$type<WorkoutEnvironment>(),
  equipment: text("equipment").array().$type<AvailableEquipment[]>(),
  otherEquipment: text("other_equipment"),
  preferredStyles: text("preferred_styles").array().$type<PreferredStyles[]>(),
  availableDays: text("available_days").array().$type<PreferredDay[]>(),
  workoutDuration: integer("workout_duration"),
  intensityLevel: text("intensity_level").$type<IntensityLevel>(),
  medicalNotes: text("medical_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Schema for insert operations
export const insertProfileSchema = createInsertSchema(profiles).omit({
  id: true,
  updatedAt: true,
});

// Types - Explicit interface for TSOA compatibility
export interface Profile {
  id: number;
  userId: number;
  age: number | null;
  height: number | null;
  weight: number | null;
  gender: Gender | null;
  goals: FitnessGoal[] | null;
  limitations: PhysicalLimitation[] | null;
  fitnessLevel: FitnessLevel | null;
  environment: WorkoutEnvironment | null;
  equipment: AvailableEquipment[] | null;
  otherEquipment: string | null;
  preferredStyles: PreferredStyles[] | null;
  availableDays: PreferredDay[] | null;
  workoutDuration: number | null;
  intensityLevel: IntensityLevel | null;
  medicalNotes: string | null;
  updatedAt: Date | null;
}

export type InsertProfile = z.infer<typeof insertProfileSchema>;

// Onboarding schema
export const onboardingSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1, "Name is required"),
  age: z.number().min(16).max(100),
  height: z.number().min(120).max(220),
  weight: z.number().min(40).max(200),
  gender: z.enum(["male", "female", "other"]),
  goals: z
    .array(z.nativeEnum(FitnessGoalsEnum))
    .min(1, "Select at least one goal"),
  limitations: z.array(z.nativeEnum(PhysicalLimitationsEnum)).optional(),
  fitnessLevel: z.nativeEnum(FitnessLevelsEnum),
  environment: z.nativeEnum(WorkoutEnvironmentsEnum),
  equipment: z.array(z.nativeEnum(AvailableEquipmentEnum)).optional(),
  otherEquipment: z.string().optional(),
  preferredStyles: z
    .array(z.nativeEnum(PreferredStylesEnum))
    .min(1, "Select at least one workout style"),
  availableDays: z
    .array(z.nativeEnum(PreferredDayEnum))
    .min(1, "Select at least one day"),
  workoutDuration: z.number().min(10).max(120),
  intensityLevel: z.nativeEnum(IntensityLevelsEnum),
  medicalNotes: z.string().optional(),
});

export type OnboardingData = z.infer<typeof onboardingSchema>;

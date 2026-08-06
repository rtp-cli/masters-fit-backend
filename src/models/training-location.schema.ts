import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { WorkoutEnvironment, AvailableEquipment } from "@/types/profile/types";
import {
  WorkoutEnvironments as WorkoutEnvironmentsEnum,
  AvailableEquipment as AvailableEquipmentEnum,
} from "@/constants/profile";
import { users } from "@/models/user.schema";

// ---------------------------------------------------------------------------
// Training locations — where a user trains. One PRIMARY row anchors the weekly
// plan (mirrors the profile's environment+equipment; see profile.service), plus
// up to three saved SECONDARIES for the days they train elsewhere. A one-off
// ("Somewhere else" with Save off) and the standing "Bodyweight only" pick are
// NOT rows here — they live only as a session snapshot on the plan day.
//
// Source-of-truth: the primary row is authoritative for environment+equipment.
// profile.environment/equipment are written as a dependent mirror from the same
// service path (single writer) so generation, the exercise-pool filter and the
// cache key keep reading profile.* unchanged.
// ---------------------------------------------------------------------------
export const trainingLocations = pgTable(
  "training_locations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    // Display name the user sees/renames. Primary defaults to "My usual place".
    name: text("name").notNull(),
    // The stored ENUM VALUE (home_gym | commercial_gym | bodyweight_only), never
    // a display label — generation is keyed off this value, not the UI string.
    environment: text("environment").$type<WorkoutEnvironment>().notNull(),
    // Resolved equipment set for this place (what generation should use).
    // Only meaningful for a custom (home_gym) environment; commercial mirrors the
    // full list and bodyweight is empty. Follows the profile.equipment column's
    // conventions exactly: one enum value per element, never comma-packed.
    equipment: text("equipment").array().$type<AvailableEquipment[]>(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_training_locations_user_id").on(table.userId),
    // Exactly one primary per user — enforced in the DB, not just the client.
    // The 4-row cap (1 primary + 3 secondaries) can't be expressed as a simple
    // constraint; it is enforced in training-location.service.
    onePrimaryPerUserIdx: uniqueIndex("uq_training_locations_one_primary")
      .on(table.userId)
      .where(sql`is_primary = true`),
  })
);

export const insertTrainingLocationSchema = createInsertSchema(
  trainingLocations
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Explicit interface for TSOA compatibility (matches the other schema files).
export interface TrainingLocation {
  id: number;
  userId: number;
  name: string;
  environment: WorkoutEnvironment;
  equipment: AvailableEquipment[] | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertTrainingLocation = z.infer<
  typeof insertTrainingLocationSchema
>;

// ---------------------------------------------------------------------------
// Frozen session-location snapshot (spec §2.2 / §9). Stored on plan_days as a
// jsonb column — same frozen-snapshot-not-FK reasoning as share_links.snapshot:
// a place can be renamed, re-equipped or deleted after the session, and a
// completed workout must still state what was actually available that day.
// A one-off has no row to point at. Comparing progress across sessions is only
// honest if each session records its own equipment (a lighter Saturday on
// kettlebells only is not a regression).
// ---------------------------------------------------------------------------
export interface TrainingLocationSnapshot {
  // Provenance only. null for a one-off or the standing "Bodyweight only" pick.
  // Never joined at read time — the snapshot below is the source of truth.
  locationId: number | null;
  // Name as shown at the time ("My usual place", "Group session", "Bodyweight
  // only"). Frozen; later renames do not touch this.
  name: string;
  // Stored enum value, as with trainingLocations.environment.
  environment: WorkoutEnvironment;
  // Equipment actually available for the session.
  equipment: AvailableEquipment[];
}

// The client/service uses this to name a place; enforce the same value sets the
// enums allow so a bad environment string can't reach the prompt switch.
export const trainingLocationInputSchema = z.object({
  name: z.string().min(1).optional(),
  environment: z.nativeEnum(WorkoutEnvironmentsEnum),
  equipment: z.array(z.nativeEnum(AvailableEquipmentEnum)).optional(),
});

export type TrainingLocationInput = z.infer<typeof trainingLocationInputSchema>;

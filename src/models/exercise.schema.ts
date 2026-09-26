import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
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
import { users } from "@/models/user.schema";

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
    // oEmbed verdict on `link`: true = playable YouTube demo, false =
    // dead/unparseable, null = not yet validated. Written at exercise
    // create/link-update time and by the backfill script — the client renders
    // demo affordances synchronously off this instead of N oEmbed calls.
    hasDemo: boolean("has_demo"),
    tag: text("tag"),
    // Null = the shared catalog every user and the generator draws from.
    // Set = a user's own exercise ("sled push + pull", "2 blocks around the
    // neighborhood"), typed in from edit-search when the catalog had nothing.
    // Owned rows must never reach generation, name resolution, or another
    // user's search — every catalog read filters on `ownerUserId IS NULL`.
    ownerUserId: integer("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
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
    // Catalog-only since custom exercises: a user's own "Sled Push" must not
    // collide with the catalog's, nor with another user's. Bare
    // onConflictDoNothing() (createExerciseInsertIgnoringConflict) still
    // matches this partial index — a targeted conflict clause would not.
    // Renamed from idx_exercises_name_unique on purpose: drizzle-kit push
    // does not detect a WHERE added to an existing index, so keeping the old
    // name would leave the global lower(name) index live on every database.
    uniqueNameIdx: uniqueIndex("idx_exercises_catalog_name_unique")
      .on(sql`lower(${table.name})`)
      .where(sql`owner_user_id IS NULL`),
    ownerNameUniqueIdx: uniqueIndex("idx_exercises_owner_name_unique")
      .on(table.ownerUserId, sql`lower(${table.name})`)
      .where(sql`owner_user_id IS NOT NULL`),
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
  // Owned rows are created only by exerciseService.createCustomExercise, never
  // through the admin/generation insert paths this schema validates.
  ownerUserId: true,
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
  hasDemo: boolean | null;
  tag: string | null;
  ownerUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertExercise = z.infer<typeof insertExerciseSchema>;

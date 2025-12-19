import {
  pgTable,
  text,
  serial,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// System config key enum
export const SYSTEM_CONFIG_KEY = {
  TEST_EMAIL: "test_email",
  FORCE_UPDATE_VERSION: "force_update_version",
  SOFT_UPDATE_VERSION: "soft_update_version",
} as const;

export type SystemConfigKeyType = typeof SYSTEM_CONFIG_KEY[keyof typeof SYSTEM_CONFIG_KEY];

// System config table
export const systemConfig = pgTable(
  "system_config",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique().$type<SystemConfigKeyType>(),
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    keyIdx: index("idx_system_config_key").on(table.key),
  })
);

// Schema for insert operations
export const insertSystemConfigSchema = createInsertSchema(systemConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSystemConfigSchema = createInsertSchema(systemConfig)
  .omit({
    id: true,
    createdAt: true,
  })
  .partial();

// Types - Explicit interfaces for TSOA compatibility
export interface SystemConfig {
  id: number;
  key: SystemConfigKeyType;
  value: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type UpdateSystemConfig = z.infer<typeof updateSystemConfigSchema>;

// Type definitions for specific config values
export interface TestEmailConfig {
  emails: string[];
}

export interface VersionConfig {
  version: string;
}


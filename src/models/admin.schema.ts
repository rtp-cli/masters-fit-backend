import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "@/models/user.schema";
import type { AdminRole } from "@/constants/admin-roles";

// Who can use the admin console, and at what level. One row per admin.
//
// ADMIN_USER_IDS (env) is NOT replaced by this table: anyone listed there is
// always treated as super_admin regardless of what is (or isn't) here — the
// break-glass path, so a bad edit to this table can never lock the owner out.
// See adminRoleService.getRole.
//
// Rows cascade with the user: an admin role means nothing once the account is
// gone, and the action log below keeps the history.
export const adminUsers = pgTable("admin_users", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().$type<AdminRole>(),
  // Who granted it (null for rows seeded by hand). No FK on purpose — the
  // granting admin may later be deleted.
  grantedBy: integer("granted_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Audit trail for every state-changing admin-console action (comp, revoke, and
// whatever comes next). Written by adminActionService.run, which inserts the
// row BEFORE the action runs and refuses to run it if the insert fails — so an
// action can never happen unrecorded. The row is then closed out as
// succeeded/failed.
//
// Like account_deletion_log, NO foreign keys: the trail must outlive both the
// admin and the target (delete-user hard-deletes accounts).
export const adminActionLog = pgTable(
  "admin_action_log",
  {
    id: serial("id").primaryKey(),
    adminUserId: integer("admin_user_id").notNull(),
    // Dotted verb, e.g. "user.comp.grant". See ADMIN_ACTIONS.
    action: text("action").notNull(),
    targetUserId: integer("target_user_id"),
    // Required by the route layer for every action — the "why".
    reason: text("reason"),
    // Action-specific inputs (e.g. { sendEmail: false }), for replaying intent.
    params: jsonb("params"),
    status: text("status")
      .notNull()
      .$type<"started" | "succeeded" | "failed">(),
    // Action-specific outcome (e.g. { emailed: true }) or the error message.
    result: jsonb("result"),
    error: text("error"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    adminIdIdx: index("idx_admin_action_log_admin_id").on(table.adminUserId),
    targetIdIdx: index("idx_admin_action_log_target_id").on(
      table.targetUserId
    ),
    createdAtIdx: index("idx_admin_action_log_created_at").on(table.createdAt),
  })
);

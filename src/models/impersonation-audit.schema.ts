import {
  pgTable,
  text,
  serial,
  integer,
  uuid,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "@/models/user.schema";

// Admin impersonation audit trail — one row per "view as user" session that an
// admin starts. Written server-side at token-mint time (see admin.routes.ts), so
// the record can't be skipped from the client. Impersonation tokens are
// read-only (blocked at auth.middleware for any non-GET), so this is the
// complete record of who looked at whose account, when, and why.
//
// FKs are NOT cascade-deleted on purpose: the audit trail must outlive both the
// admin and the target account (account deletion is a soft delete today, but
// this stays correct even if a hard delete is ever added).
export const impersonationAudit = pgTable(
  "impersonation_audit",
  {
    id: serial("id").primaryKey(),
    // Matches the `imp.sid` claim in the minted JWT, so a token can be traced
    // back to the row that authorized it.
    sessionId: uuid("session_id").notNull().defaultRandom(),
    adminUserId: integer("admin_user_id")
      .notNull()
      .references(() => users.id),
    targetUserId: integer("target_user_id")
      .notNull()
      .references(() => users.id),
    // Free-text reason the admin typed when starting the session.
    reason: text("reason"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    adminIdIdx: index("idx_impersonation_audit_admin_id").on(table.adminUserId),
    targetIdIdx: index("idx_impersonation_audit_target_id").on(
      table.targetUserId
    ),
    createdAtIdx: index("idx_impersonation_audit_created_at").on(
      table.createdAt
    ),
  })
);

// Types - Explicit interface for TSOA compatibility
export interface ImpersonationAudit {
  id: number;
  sessionId: string;
  adminUserId: number;
  targetUserId: number;
  reason: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

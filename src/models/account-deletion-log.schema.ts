import {
  pgTable,
  serial,
  integer,
  text,
  uuid,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Audit trail for HARD account deletions. One row written (inside the same
// transaction as the purge) each time a user + all their data is permanently
// removed — by the in-app Delete Account flow or the delete-user ops script.
//
// Deliberately has NO foreign key to users: the whole point is that this record
// OUTLIVES the deleted account. deletedUserId is a plain integer snapshot of the
// id that was removed.
//
// The email is stored ONLY as a SHA-256 of its normalized (trim + lowercase)
// form — enough to answer "was foo@bar.com deleted, and when?" (hash the
// candidate the same way and look it up) without retaining the plaintext PII we
// just erased. Lookups MUST normalize identically before hashing.
export const accountDeletionLog = pgTable(
  "account_deletion_log",
  {
    id: serial("id").primaryKey(),
    // Snapshot of the deleted user's id — NOT a FK (the user is gone).
    deletedUserId: integer("deleted_user_id").notNull(),
    // The deleted user's uuid, kept plaintext to cross-reference Sentry/Mixpanel.
    uuid: uuid("uuid"),
    // SHA-256 hex of the normalized (trim + lowercase) email. One-way.
    emailHash: text("email_hash").notNull(),
    // Who triggered it: 'self_service' (app) | 'ops_script' | 'admin'.
    source: text("source").notNull(),
    // Operator/admin identifier for non-self-service deletions; null for self.
    actor: text("actor"),
    // Per-table counts of what was removed, for compliance/verification.
    rowsDeleted: jsonb("rows_deleted"),
    // Optional free-text reason.
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailHashIdx: index("idx_account_deletion_log_email_hash").on(table.emailHash),
    deletedUserIdIdx: index("idx_account_deletion_log_deleted_user_id").on(table.deletedUserId),
    createdAtIdx: index("idx_account_deletion_log_created_at").on(table.createdAt),
  })
);

// Types — explicit interface for TSOA compatibility (matches the schema pattern).
export interface AccountDeletionLog {
  id: number;
  deletedUserId: number;
  uuid: string | null;
  emailHash: string;
  source: string;
  actor: string | null;
  rowsDeleted: Record<string, number> | null;
  reason: string | null;
  createdAt: Date;
}

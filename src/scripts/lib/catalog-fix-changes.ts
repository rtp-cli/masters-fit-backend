/**
 * The pure half of catalog-fix.ts: turn `--set col=value` / `--clear col`
 * arguments into validated column changes, diff them against the current row,
 * and build the rollback command. No database access, so it is unit-tested.
 *
 * Column names are the DATABASE names (snake_case), because that is what the
 * read-back query in the prod-catalog-fix skill prints — the operator copies
 * from what they see.
 */
import { AvailableEquipment, IntensityLevels } from "@/constants/profile";
import { CANONICAL_MUSCLE_GROUPS } from "@/constants/muscle-groups";

type ColumnKind = "text" | "enum" | "enum-array";

interface EditableColumn {
  /** The drizzle property on the `exercises` table. */
  key: string;
  kind: ColumnKind;
  nullable: boolean;
  allowed?: readonly string[];
}

export const EDITABLE_COLUMNS: Record<string, EditableColumn> = {
  name: { key: "name", kind: "text", nullable: false },
  description: { key: "description", kind: "text", nullable: true },
  instructions: { key: "instructions", kind: "text", nullable: false },
  tag: { key: "tag", kind: "text", nullable: true },
  difficulty: {
    key: "difficulty",
    kind: "enum",
    nullable: true,
    allowed: Object.values(IntensityLevels),
  },
  equipment: {
    key: "equipment",
    kind: "enum-array",
    nullable: true,
    allowed: Object.values(AvailableEquipment),
  },
  muscle_groups: {
    key: "muscleGroups",
    kind: "enum-array",
    nullable: false,
    allowed: CANONICAL_MUSCLE_GROUPS,
  },
};

/** Columns this tool refuses, with where to go instead. */
export const REFUSED_COLUMNS: Record<string, string> = {
  link:
    "use `npm run fix-exercise-link` — it shows the video's title so a human " +
    "can check it matches, and re-derives has_demo from the new link",
  has_demo:
    "it is derived from `link` by oEmbed; fix the link with " +
    "`npm run fix-exercise-link` and has_demo follows",
  id: "the primary key is not editable",
  owner_user_id:
    "moving a row between the catalog and a user's custom exercises is not a catalog fix",
  created_at: "not editable",
  updated_at: "set automatically on every write",
};

export type ColumnValue = string | string[] | null;

export interface Change {
  column: string;
  key: string;
  value: ColumnValue;
}

function parseValue(column: string, spec: EditableColumn, raw: string): ColumnValue {
  if (spec.kind === "enum-array") {
    const items = [
      ...new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (!items.length) {
      throw new Error(
        spec.nullable
          ? `${column}: empty list — use --clear ${column} to set it to NULL.`
          : `${column}: must list at least one value.`,
      );
    }
    const bad = items.filter((v) => !spec.allowed!.includes(v));
    if (bad.length) {
      throw new Error(
        `${column}: unknown value(s) ${bad.join(", ")}.\n  Allowed: ${spec.allowed!.join(", ")}`,
      );
    }
    return items;
  }

  const value = raw.trim();
  if (!value) {
    throw new Error(
      spec.nullable
        ? `${column}: empty value — use --clear ${column} to set it to NULL.`
        : `${column}: cannot be empty.`,
    );
  }
  if (spec.kind === "enum" && !spec.allowed!.includes(value)) {
    throw new Error(
      `${column}: unknown value "${value}".\n  Allowed: ${spec.allowed!.join(", ")}`,
    );
  }
  return value;
}

function lookup(column: string): EditableColumn {
  if (REFUSED_COLUMNS[column]) {
    throw new Error(`${column}: not editable here — ${REFUSED_COLUMNS[column]}.`);
  }
  const spec = EDITABLE_COLUMNS[column];
  if (!spec) {
    throw new Error(
      `${column}: not an exercises column this tool edits.\n  Editable: ${Object.keys(EDITABLE_COLUMNS).join(", ")}`,
    );
  }
  return spec;
}

/**
 * Parse every `--set col=value` and `--clear col`. Throws with an
 * operator-readable message on the first problem, so a bad argument never
 * reaches the database.
 */
export function parseChanges(sets: string[], clears: string[]): Change[] {
  const changes: Change[] = [];
  const seen = new Set<string>();

  const claim = (column: string) => {
    if (seen.has(column)) {
      throw new Error(`${column}: given more than once.`);
    }
    seen.add(column);
  };

  for (const arg of sets) {
    const eq = arg.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--set expects column=value, got "${arg}".`);
    }
    const column = arg.slice(0, eq).trim();
    const spec = lookup(column);
    claim(column);
    changes.push({ column, key: spec.key, value: parseValue(column, spec, arg.slice(eq + 1)) });
  }

  for (const column of clears) {
    const spec = lookup(column);
    if (!spec.nullable) {
      throw new Error(`${column}: is NOT NULL, so it cannot be cleared.`);
    }
    claim(column);
    changes.push({ column, key: spec.key, value: null });
  }

  if (!changes.length) {
    throw new Error("Nothing to change — pass at least one --set or --clear.");
  }
  return changes;
}

/** Order-sensitive: reordering muscle_groups counts as a change. */
export function sameValue(a: ColumnValue, b: ColumnValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function formatValue(value: ColumnValue): string {
  return value === null ? "NULL" : JSON.stringify(value);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The flags that put every changed column back to what it was before.
 * `before` is keyed by column name.
 */
export function rollbackArgs(
  changes: Change[],
  before: Record<string, ColumnValue>,
): string {
  return changes
    .map(({ column }) => {
      const old = before[column];
      if (old === null) return `--clear ${column}`;
      const raw = Array.isArray(old) ? old.join(",") : old;
      return `--set ${shellQuote(`${column}=${raw}`)}`;
    })
    .join(" ");
}

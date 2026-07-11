---
name: change-db-schema
description: Use when changing the database — adding or modifying a table, column, index, or relation; "add a field to X", "create a table for Y", "store Z in the database". Covers editing the Drizzle schema, registering it, pushing to Postgres, and verifying.
---

# Change the database schema

The database is defined in code using **Drizzle** (`src/models/*.schema.ts`). Changing the
database is a 4-step process. The most important thing to understand: **editing a schema file
changes nothing on its own.** The change only reaches the real database when you _push_ it.

This project uses **push-based sync** (`drizzle-kit push`) — there are **no migration files and
no down-migrations**. That shapes everything below: additive changes are easy, destructive ones
have no automatic rollback.

Example used below: adding a `favoriteCount` column to the `workouts` table.

## Step 1 — Edit (or add) the schema file

Schema files live in `src/models/<resource>.schema.ts` and use Drizzle's `pgTable`. To change
an existing table, edit its definition; to add a table, add a new `pgTable` (or a new file).

```ts
// in src/models/workout.schema.ts
export const workouts = pgTable("workouts", {
  // ...existing columns...
  favoriteCount: integer("favorite_count").default(0), // <- new column
});
```

Conventions to match:

- **Column DB names are snake_case** (`favorite_count`), even though the TS field is camelCase.
- Import the column type you need (`integer`, `text`, `boolean`, `timestamp`, …) from
  `drizzle-orm/pg-core` — see the top of any existing schema file.
- Give new non-nullable columns a `.default(...)` (existing rows need a value). If the value must
  be **computed** per-row rather than a constant, that's a backfill — see the callout below.
- **New timestamp columns should use `timestamp(..., { withTimezone: true })` (i.e. `timestamptz`).**
  The schema currently mixes naive `timestamp` and `timestamptz`, which is one root of the known
  local-vs-UTC "today"/streak bug. Don't add another naive `timestamp` unless you have a specific
  reason.

### Backfilling a NOT NULL column on an existing table (no static default)

`drizzle-kit push` can only apply a constant `.default(...)` — it cannot compute per-row values.
If the new column needs values derived from existing rows (e.g. a hash of other columns), do it
in three moves:

1. Add the column **nullable** (no `NOT NULL`), push.
2. Run a one-off backfill script that populates it (follow the pattern in `src/scripts/`, e.g.
   `tsx src/scripts/<your-backfill>.ts`).
3. Change it to `.notNull()` in the schema, push again.

On a large table, doing this as a single `NOT NULL`-with-no-default push will fail or lock the
table — always split it.

## Step 2 — Register the table (only if you created a NEW table or file)

Drizzle reads everything through `src/models/index.ts`. If you added a **new schema file**,
add a matching `export * from "@/models/<resource>.schema";` line there. Editing an
**existing** table needs no change here.

## Step 3 — Review, then push the change to Postgres

First **preview** the diff read-only (this prints the proposed SQL and applies nothing — it
feeds EOF to the confirmation prompt so Drizzle aborts):

```bash
npm run db:check
```

Read every statement. If it's purely additive (CREATE / ADD COLUMN / ADD INDEX), apply it:

```bash
npm run db:push
```

This compares your code to the live database and applies the difference. It's interactive —
confirm the diff matches what `db:check` showed, then select "Yes, execute all statements".

⚠️ **This edits a real database.** Be especially careful with anything that says it will
**drop** a column or table, or **truncate** data — that destroys data. When in doubt, stop and
ask the team. Prefer additive changes (new nullable column, or with a default) over
renames/drops. **Never use `--force`** — it auto-approves data-loss statements.

### Renames are a trap

When you rename a column/table, `drizzle-kit push` can't tell a rename from a "drop the old one,
create a new one" — during the **interactive** `db:push` it prompts *"is this a rename, or
created/deleted?"*. Choosing "created" on what was meant as a rename **drops the old column and
all its data**. Two rules:

- Watch for that prompt on any rename and choose "rename" only when you're certain.
- `db:check`'s preview feeds EOF, so it auto-resolves that ambiguity and may show a create/drop
  that does **not** match the choice you'll make interactively — for renames, trust the live
  `db:push` prompt, not the preview.

> These commands target whatever `DATABASE_URL` points to (the `.env` default is your **local**
> DB). To deploy the same change to **production**, use the `deploy-db` command, which runs the
> review-then-apply flow against Neon.

### Rollback reality (production)

Push-based sync has **no down-migration**. If a prod push drops/renames/retypes something, the
only recovery is a Neon branch or point-in-time restore — which is account-level and loses writes
made after the incident. Before any destructive prod push, take a Neon branch snapshot first as a
tested rollback target, and get explicit sign-off. Additive-only pushes don't need this.

## Step 4 — Keep the types in sync

If other code (services, types, Zod schemas via `createInsertSchema`) needs the new field,
update it now so TypeScript stays happy.

## ✅ How to know it worked

```bash
npm run tsc          # see note below
npm run db:studio    # opens a DB GUI in the browser
```

- **`npm run tsc`** currently has a standing baseline of pre-existing errors unrelated to your
  change. Confirm your schema change introduces **no new** errors — diff against `main` rather
  than expecting a zero count.
- In **Drizzle Studio**, open the table and confirm the new column/table is actually there with
  the right type. Then exercise any code that reads/writes it and confirm it behaves.

If `db:studio` doesn't show your change, the push (Step 3) didn't run or didn't apply —
re-run `npm run db:push` and read its output.

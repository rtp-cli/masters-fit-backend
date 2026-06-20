---
name: change-db-schema
description: Use when changing the database — adding or modifying a table, column, index, or relation; "add a field to X", "create a table for Y", "store Z in the database". Covers editing the Drizzle schema, registering it, pushing to Postgres, and verifying.
---

# Change the database schema

The database is defined in code using **Drizzle** (`src/models/*.schema.ts`). Changing the
database is a 4-step process. The most important thing to understand: **editing a schema file
changes nothing on its own.** The change only reaches the real database when you _push_ it.

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
- Give new non-nullable columns a `.default(...)` (existing rows need a value).

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

> These commands target whatever `DATABASE_URL` points to (the `.env` default is your **local**
> DB). To deploy the same change to **production**, use the `deploy-db` command, which runs the
> review-then-apply flow against Neon.

## Step 4 — Keep the types in sync

If other code (services, types, Zod schemas via `createInsertSchema`) needs the new field,
update it now so TypeScript stays happy.

## ✅ How to know it worked

```bash
npm run tsc          # no type errors from the schema change
npm run db:studio    # opens a DB GUI in the browser
```

In Drizzle Studio, open the table and confirm the new column/table is actually there with the
right type. Then exercise any code that reads/writes it and confirm it behaves.

If `db:studio` doesn't show your change, the push (Step 3) didn't run or didn't apply —
re-run `npm run db:push` and read its output.

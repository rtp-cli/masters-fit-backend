---
name: prod-catalog-fix
description: Use to correct fields on ONE shared-catalog exercise by id on PRODUCTION (Neon) — a wrong difficulty, missing equipment, a muscle group the overload check should see, a typo'd name, bad instructions/description, or a wrong tag. Triggers "/prod-catalog-fix", "fix exercise 1131's difficulty", "exercise X should list dumbbells", "that exercise is tagged wrong", "rename exercise N". Writes to the LIVE catalog, which every user's workouts read from — preview, confirm, apply, read back. Reversible (prints the rollback command). For a wrong demo VIDEO use fix-exercise-link (npm run fix-exercise-link); for a user's own custom exercise, this tool refuses by design.
---

# Prod Catalog Fix — correct one exercise row

Updates named columns on one row of `exercises` where `owner_user_id IS NULL` (the shared
catalog). Backed by `src/scripts/catalog-fix.ts` (`npm run catalog-fix`), with the parsing and
validation in `src/scripts/lib/catalog-fix-changes.ts`.

Catalog rows are joined into every workout at read time, so one update corrects every past and
future workout that uses the exercise. No app build or OTA is needed.

> ✅ **Reversible.** The apply prints an exact rollback command that restores every column it
> changed. The preview shows the full before-values too, so nothing is lost even without it.

## Inputs

- **An exercise id** (required). If the user gave a name, look the id up read-only first:
  `scripts/db-prod-read.sh -c "select id, name from exercises where owner_user_id is null and name ilike '%rdl%';"`.
  Get the user to confirm which row if more than one matches. Never guess.
- **Field changes**, as `--set <column>=<value>` or `--clear <column>`. Column names are the
  DATABASE names:

| Column | Kind | Rules |
|---|---|---|
| `name` | text, NOT NULL | refused if another catalog row has it (case-insensitive) |
| `description` | text, nullable | `--clear` to NULL |
| `instructions` | text, NOT NULL | |
| `tag` | text, nullable | warns if no other catalog row uses that tag, since that usually means a typo |
| `difficulty` | enum, nullable | `low` / `moderate` / `high` (`IntensityLevels`) |
| `equipment` | enum list, nullable | comma-separated `AvailableEquipment` values; **replaces** the whole list |
| `muscle_groups` | enum list, NOT NULL | comma-separated, the 18 canonical groups (`CANONICAL_MUSCLE_GROUPS`); **replaces** the whole list |

Refused, with a pointer to the right tool: `link` and `has_demo` (use `fix-exercise-link`, which
shows the video title), `id`, `owner_user_id`, `created_at`, and `updated_at` (set automatically).

## Guardrails

1. **Only the row and columns the user named.** Don't "also fix" a neighbouring field you
   noticed. Mention it, and let the user decide.
2. **List columns replace; they don't append.** "Add a bench to 1131" means reading the current
   `equipment` from the preview and passing the *full* new list. Show the before/after so the
   user can see nothing was dropped.
3. **Always preview first, and get an explicit yes via AskUserQuestion before `--apply`.** The
   script previews unless `--apply` is passed, and that preview is the dry-run. Put the
   before/after lines and the Neon host into the question. A yes to one preview covers that exact
   command only: if anything changes, preview again.
4. **Name the Neon host back to the user** (from the `with-prod-url: DATABASE_URL -> <host>`
   line). Never print anything that resolves to the credential.
5. **Renames have a tail.** Plans reference exercises by id, so history follows the rename. But
   generation creates exercises BY NAME (`createExerciseIfNotExists`), so if the model keeps
   emitting the old name, a fresh duplicate row can reappear under it. Say this when renaming, and
   suggest a read-only check for the old name in a few days.
6. **A heads-up belongs in the confirmation, not in the apply.** Stop and flag it before asking
   if the preview shows `⚠️ No other catalog exercise has tag`, or if `muscle_groups` loses a
   group (that changes the consecutive-day overload check for everyone).

## Where it runs

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

For prod, **never handle the connection string yourself**. Prefix with `scripts/with-prod-url.sh`,
which injects `DATABASE_URL` from the macOS Keychain into the child process only. `--remote` is
also required, because the script refuses a non-local host without it.

## The workflow (all five, in order)

### 1. Freshness check — be on an up-to-date main
The code that writes to prod is THIS checkout's, not Render's.

```bash
git status -sb                # expect "## main...origin/main" and no changes
git pull --ff-only
```
If the checkout isn't on `main`, or has uncommitted changes, stop and say so. Don't switch
branches or stash on the user's behalf (another session may own that work). As a backstop,
`catalog-fix` also runs `assertCheckoutIsCurrent` itself: on `--apply` it refuses to run if HEAD
is behind `origin/main`. `--stale-ok` overrides that, but only use it if the user explicitly asks.

### 2. Preview (the dry-run)
```bash
scripts/with-prod-url.sh npm run catalog-fix -- --id 1131 \
  --set difficulty=moderate --set 'equipment=dumbbells,bench' --remote
```
Single-quote any value with spaces, commas, or shell characters. Expect the host line, `PREVIEW`,
and then `before:` / `after:` per column. A column marked `(already this value — no change)` is a
no-op. `Every value already matches. Nothing to do.` means stop there and say so.

### 3. Confirm
Use AskUserQuestion. Include the exercise id and name, the host, and each column's before → after.
Options: apply, or cancel. Nothing gets written without a yes.

### 4. Apply
Re-run **the identical command** with `--apply` appended:
```bash
scripts/with-prod-url.sh npm run catalog-fix -- --id 1131 \
  --set difficulty=moderate --set 'equipment=dumbbells,bench' --remote --apply
```
Expect `✅ Updated exercise <id>` and a `To roll back:` command. Copy the rollback command into
your report verbatim.

### 5. Verify — read the row back through the read-only wrapper
```bash
scripts/db-prod-read.sh -x -c "select id, name, difficulty, equipment, muscle_groups, tag, description, instructions, owner_user_id, updated_at from exercises where id = 1131;"
```
This connection is independent of the writer, and Postgres itself refuses writes on it. Confirm
that every changed column shows the new value and that `updated_at` is just now, and report the
row back. Don't call it done off the apply output alone.

## Rolling back

Run the `To roll back:` command the apply printed. It is a normal `--apply` run, so preview it
first (drop `--apply`), confirm, apply, and read back, the same as above.

## Related

- **fix-exercise-link** (`npm run fix-exercise-link`) — a wrong demo video. It shows the oEmbed
  title and re-derives `has_demo`.
- **dedupe-exercises.ts** — merging two catalog rows. A rename collision here means that tool, not this one.
- **fix-muscle-groups.ts / migrate-muscle-taxonomy.ts** — bulk taxonomy passes, not one-row fixes.

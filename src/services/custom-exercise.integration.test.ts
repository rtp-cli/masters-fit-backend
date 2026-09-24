import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { exercises } from "@/models/exercise.schema";
import { exerciseExclusions } from "@/models/exercise-exclusion.schema";
import { exerciseService } from "@/services/exercise.service";
import { searchService } from "@/services/search.service";

/**
 * Integration test for users' own exercises. Runs against the LOCAL database
 * (exercises.owner_user_id + the two partial unique indexes must be pushed).
 * Skips cleanly when no DB is reachable so DB-less CI does not fail.
 *
 * What only real SQL can prove: that the partial indexes let two users (and a
 * user and the catalog) share a name, that a racing double-create lands one
 * row, and that every catalog reader the generator and LLM name resolution use
 * genuinely can't see an owned row.
 */
let dbAvailable = false;
const createdUserIds: number[] = [];
const createdExerciseIds: number[] = [];

const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
/** Unique per run, and distinctive enough that no catalog row fuzzy-matches it. */
const uniqueName = (label: string) => `Zq ${label} ${tag}`;

async function makeUser(label: string): Promise<number> {
  const [row] = await db
    .insert(users)
    .values({
      email: `custom-ex-${tag}-${label}@testers.mastersfit.ai`,
      name: "Test Person",
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

async function makeOwn(userId: number, name: string) {
  const row = await exerciseService.createCustomExercise(userId, name);
  createdExerciseIds.push(row.id);
  return row;
}

describe("Custom exercises (integration, local DB)", () => {
  let kim: number;
  let other: number;

  beforeAll(async () => {
    try {
      await db.execute(sql`select 1`);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
    if (!dbAvailable) return;
    kim = await makeUser("kim");
    other = await makeUser("other");
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    if (createdExerciseIds.length > 0) {
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    if (createdUserIds.length > 0) {
      // Cascades any owned rows a failed assertion left behind.
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  describe("createCustomExercise", () => {
    it("stores a bare owned row: trimmed name, no muscles, no equipment", async () => {
      if (!dbAvailable) return;
      const row = await makeOwn(kim, `  ${uniqueName("Sled   push")}  `);
      expect(row.ownerUserId).toBe(kim);
      expect(row.name).toBe(uniqueName("Sled push"));
      expect(row.muscleGroups).toEqual([]);
      expect(row.equipment).toBeNull();
    });

    it("returns the existing row for the same name, any case", async () => {
      if (!dbAvailable) return;
      const first = await makeOwn(kim, uniqueName("Hill repeats"));
      const again = await makeOwn(kim, uniqueName("HILL REPEATS"));
      expect(again.id).toBe(first.id);
    });

    it("lands exactly one row when two creates race", async () => {
      if (!dbAvailable) return;
      // Warm the pool, or pg's one-at-a-time connects serialize the race away.
      await Promise.all(Array.from({ length: 6 }, () => db.execute(sql`select 1`)));
      const name = uniqueName("Race");
      const rows = await Promise.all(
        Array.from({ length: 6 }, () => makeOwn(kim, name))
      );
      expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    });

    it("lets two users, and a user and the catalog, share a name", async () => {
      if (!dbAvailable) return;
      const name = uniqueName("Neighborhood loop");
      const mine = await makeOwn(kim, name);
      const theirs = await makeOwn(other, name);
      expect(theirs.id).not.toBe(mine.id);

      // The generator introducing the same name makes a CATALOG row rather
      // than reusing Kim's — owned rows are invisible to its lookup.
      const catalog = await exerciseService.createExerciseIfNotExists({
        name,
        instructions: "test",
        muscleGroups: ["full_body"],
      } as any);
      createdExerciseIds.push(catalog.id);
      expect(catalog.ownerUserId).toBeNull();
      expect([mine.id, theirs.id]).not.toContain(catalog.id);
    });

    it("rejects an empty or overlong name", async () => {
      if (!dbAvailable) return;
      await expect(exerciseService.createCustomExercise(kim, "   ")).rejects.toThrow();
      await expect(
        exerciseService.createCustomExercise(kim, "x".repeat(81))
      ).rejects.toThrow();
    });
  });

  describe("catalog readers never see an owned row", () => {
    it("name resolution and the generation pool skip it", async () => {
      if (!dbAvailable) return;
      const name = uniqueName("Private only");
      await makeOwn(kim, name);

      expect(await exerciseService.getExerciseByName(name)).toBeUndefined();
      expect(await exerciseService.getExercisesByNames([name])).toEqual([]);
      const resolved = await exerciseService.resolveExercisesByNames([name]);
      expect(resolved.unresolved).toEqual([name]);

      const pool = await exerciseService.getGenerationCatalogPool();
      expect(pool.map((e) => e.name)).not.toContain(name);
      const listed = await exerciseService.getExercises();
      expect(listed.map((e) => e.name)).not.toContain(name);
    });

    it("the user-less global search skips it", async () => {
      if (!dbAvailable) return;
      const name = uniqueName("Global hidden");
      await makeOwn(kim, name);
      const result = await searchService.searchExercises(name);
      expect(result.exercises.map((e) => e.name)).not.toContain(name);
    });
  });

  describe("searchExercisesWithFilters", () => {
    const search = (userId: number, query: string | undefined, extra: object = {}) =>
      searchService
        .searchExercisesWithFilters(userId, {
          query,
          userEquipmentOnly: false,
          includeOwnExercises: true,
          ...extra,
        })
        .then((r) => r.exercises.map((e) => e.name));

    it("finds the owner's own exercise by name, even under a muscle filter", async () => {
      if (!dbAvailable) return;
      const name = uniqueName("Sled pull");
      await makeOwn(kim, name);
      expect(await search(kim, name)).toContain(name);
      expect(
        await search(kim, name, { muscleGroups: ["chest"], difficulty: "advanced" })
      ).toContain(name);
    });

    it("never shows it to another user", async () => {
      if (!dbAvailable) return;
      const name = uniqueName("Not yours");
      await makeOwn(kim, name);
      expect(await search(other, name)).not.toContain(name);
    });

    it("leaves it out unless opted in, and when browsing without a query", async () => {
      if (!dbAvailable) return;
      const name = uniqueName("Opt in");
      await makeOwn(kim, name);
      expect(await search(kim, name, { includeOwnExercises: false })).not.toContain(name);
      expect(await search(kim, undefined, { limit: 5000 })).not.toContain(name);
    });
  });

  describe("searchExercisesWithFilters text query keeps every other filter", () => {
    // Regression: the text condition was an unparenthesized OR chain, so a
    // name match short-circuited the AND of every condition after it.
    it("does not offer back an exercise the user excluded, even by exact name", async () => {
      if (!dbAvailable) return;
      const catalog = await exerciseService.createExerciseIfNotExists({
        name: uniqueName("Excluded lift"),
        instructions: "test",
        muscleGroups: ["chest"],
      } as any);
      createdExerciseIds.push(catalog.id);
      await db
        .insert(exerciseExclusions)
        .values({ userId: kim, exerciseId: catalog.id, reason: "dislike" });

      const names = (
        await searchService.searchExercisesWithFilters(kim, {
          query: catalog.name,
          userEquipmentOnly: false,
        })
      ).exercises.map((e) => e.name);
      expect(names).not.toContain(catalog.name);
    });
  });

  describe("isUsableBy", () => {
    it("allows catalog rows and your own, refuses someone else's", async () => {
      if (!dbAvailable) return;
      const mine = await makeOwn(kim, uniqueName("Usable"));
      const [catalogRow] = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(sql`${exercises.ownerUserId} IS NULL`)
        .limit(1);

      expect(await exerciseService.isUsableBy(mine.id, kim)).toBe(true);
      expect(await exerciseService.isUsableBy(mine.id, other)).toBe(false);
      expect(await exerciseService.isUsableBy(catalogRow.id, other)).toBe(true);
      expect(await exerciseService.isUsableBy(-1, kim)).toBe(false);
    });
  });
});

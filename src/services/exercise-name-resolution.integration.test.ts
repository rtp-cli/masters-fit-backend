import { describe, it, expect, beforeAll } from "@jest/globals";
import { sql } from "drizzle-orm";
import { db } from "@/config/database";
import { exerciseService } from "@/services/exercise.service";

/**
 * Integration test for ExerciseService.resolveExercisesByNames. Runs against
 * the LOCAL database (whose catalog mirrors prod's names as of 2026-09-07) and
 * skips cleanly when no DB is reachable so DB-less CI does not fail.
 *
 * Only real SQL can prove the regexp_replace passes match what the index-backed
 * exact pass misses — these are the exact names that were silently dropped in
 * prod (forensics of workout 845 / the last 50 workouts).
 */
let dbAvailable = false;
const hasRow = async (name: string) =>
  (await exerciseService.getExercisesByNames([name])).length > 0;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

describe("ExerciseService.resolveExercisesByNames (integration)", () => {
  it("resolves exact names with no substitutions", async () => {
    if (!dbAvailable || !(await hasRow("Barbell Back Squat"))) return;
    const r = await exerciseService.resolveExercisesByNames(["Barbell Back Squat"]);
    expect(r.byRequestedName.get("Barbell Back Squat")?.name).toBe("Barbell Back Squat");
    expect(r.substitutions).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });

  it("matches a straight apostrophe to the catalog's curly one (the #1 prod drop)", async () => {
    if (!dbAvailable || !(await hasRow("Farmer’s Carry"))) return;
    const r = await exerciseService.resolveExercisesByNames(["Farmer's Carry"]);
    expect(r.byRequestedName.get("Farmer's Carry")?.name).toBe("Farmer’s Carry");
    expect(r.substitutions).toEqual([
      { requested: "Farmer's Carry", resolved: "Farmer’s Carry", via: "normalized" },
    ]);
  });

  it("resolves the Wendler alias that emptied a deadlift block", async () => {
    if (!dbAvailable || !(await hasRow("Barbell Conventional Deadlift"))) return;
    const r = await exerciseService.resolveExercisesByNames(["Barbell Deadlift"]);
    expect(r.byRequestedName.get("Barbell Deadlift")?.name).toBe("Barbell Conventional Deadlift");
    expect(r.substitutions[0]?.via).toBe("alias");
  });

  it("matches a plural to the singular catalog row", async () => {
    if (!dbAvailable || !(await hasRow("Kettlebell Swing"))) return;
    const r = await exerciseService.resolveExercisesByNames(["Kettlebell Swings"]);
    expect(r.byRequestedName.get("Kettlebell Swings")?.name).toBe("Kettlebell Swing");
    expect(r.substitutions[0]?.via).toBe("singular");
  });

  it("reports names that match nothing instead of inventing a row", async () => {
    if (!dbAvailable) return;
    const bogus = "Totally Made Up Movement 9000";
    const r = await exerciseService.resolveExercisesByNames([bogus, "Barbell Back Squat"]);
    expect(r.unresolved).toEqual([bogus]);
    expect(r.byRequestedName.has(bogus)).toBe(false);
  });

  it("keeps the caller's exact requested string as the map key", async () => {
    if (!dbAvailable || !(await hasRow("Push-Up"))) return;
    const r = await exerciseService.resolveExercisesByNames(["  push-up "]);
    // trimmed on the way in, so callers that trim get the same key back
    expect(r.byRequestedName.get("push-up")?.name).toBe("Push-Up");
  });
});

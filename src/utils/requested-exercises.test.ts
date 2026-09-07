import { describe, it, expect } from "@jest/globals";
import type { ExerciseMetadata } from "@/services/exercise.service";
import {
  findRequestedExercises,
  selectCanonicalBasics,
  pinExercises,
  formatGenerationMenu,
  MAX_PINNED_EXERCISES,
} from "./requested-exercises";

const ex = (name: string, extra: Partial<ExerciseMetadata> = {}): ExerciseMetadata => ({
  name,
  equipment: null,
  muscleGroups: ["core"],
  difficulty: null,
  ...extra,
});

const POOL: ExerciseMetadata[] = [
  ex("Strict Pull-Up", { equipment: ["pull_up_bar"], muscleGroups: ["back"] }),
  ex("Band-Assisted Pull-Up", { equipment: ["pull_up_bar"], muscleGroups: ["back"], tag: "crossfit" }),
  ex("Push-Up", { equipment: ["bodyweight"], muscleGroups: ["chest"] }),
  ex("Decline Push-Up", { equipment: ["bench"], muscleGroups: ["chest"], tag: "crossfit" }),
  ex("Air Squat", { equipment: ["bodyweight"], muscleGroups: ["quads"] }),
  ex("Air Squats", { equipment: ["bodyweight"], muscleGroups: ["quads"], hasDemo: true }),
  ex("Sit-Up", { equipment: ["bodyweight"] }),
  ex("Barbell Bench Press", { equipment: ["barbells"], muscleGroups: ["chest"] }),
  ex("Barbell Back Squat", { equipment: ["barbells"], muscleGroups: ["glutes"] }),
  ex("Barbell Conventional Deadlift", { equipment: ["barbells"], muscleGroups: ["glutes"] }),
  ex("Row", { equipment: ["rowing_machine"], muscleGroups: ["cardio"] }),
  ex("Curl", { equipment: ["dumbbells"], muscleGroups: ["biceps"] }),
  ex("Barbell Curl", { equipment: ["barbells"], muscleGroups: ["biceps"] }),
  ex("Butterfly Fold", { equipment: ["foam_roller"], muscleGroups: ["hips"] }),
];

const RICH_REQUEST =
  "Monday: Wendler 531 Week 1 bench press, including warm-up sets based on 1RM of 235# + CrossFit-style METCON circuit\n" +
  "Tuesday: Calisthenics Challenge workout — 10 RFT, 1. 6x strict pull-ups, 15x push-ups, 20x air squats, 20x sit-ups";

describe("findRequestedExercises", () => {
  it("pins the movements a request names, plural- and punctuation-insensitively", () => {
    const names = findRequestedExercises(RICH_REQUEST, POOL).map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(["Strict Pull-Up", "Push-Up", "Sit-Up"])
    );
    // "air squats" matches both Air Squat rows → collapsed to one, preferring the demo'd row
    expect(names.filter((n) => n.startsWith("Air Squat"))).toEqual(["Air Squats"]);
  });

  it("resolves fully-qualified alias n-grams to their canonical row", () => {
    const names = findRequestedExercises(RICH_REQUEST, POOL).map((e) => e.name);
    expect(names).toContain("Barbell Bench Press"); // via "bench press"
  });

  it("does not pin the near-variants the model used to substitute", () => {
    const names = findRequestedExercises(RICH_REQUEST, POOL).map((e) => e.name);
    expect(names).not.toContain("Band-Assisted Pull-Up");
    expect(names).not.toContain("Decline Push-Up");
  });

  it("ignores short generic single-token names but keeps multi-token ones", () => {
    const names = findRequestedExercises(
      "add a row and some barbell curls, then row 500m",
      POOL
    ).map((e) => e.name);
    expect(names).not.toContain("Row");
    expect(names).not.toContain("Curl");
    expect(names).toContain("Barbell Curl");
  });

  it("requires the name tokens to be contiguous", () => {
    const names = findRequestedExercises("bench work then a heavy press", POOL).map((e) => e.name);
    expect(names).not.toContain("Barbell Bench Press");
  });

  it("returns nothing for an empty request or pool", () => {
    expect(findRequestedExercises("", POOL)).toEqual([]);
    expect(findRequestedExercises(undefined, POOL)).toEqual([]);
    expect(findRequestedExercises(RICH_REQUEST, [])).toEqual([]);
  });

  it("only ever returns rows from the pool (a limitation-filtered pool stays filtered)", () => {
    const noPullUps = POOL.filter((e) => !e.name.includes("Pull-Up"));
    const names = findRequestedExercises(RICH_REQUEST, noPullUps).map((e) => e.name);
    expect(names.some((n) => n.includes("Pull-Up"))).toBe(false);
  });
});

describe("selectCanonicalBasics", () => {
  it("reserves the staples present in the pool for lifting/conditioning users", () => {
    const names = selectCanonicalBasics(POOL, ["strength", "crossfit"]).map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Strict Pull-Up",
        "Push-Up",
        "Air Squat",
        "Sit-Up",
        "Barbell Bench Press",
        "Barbell Back Squat",
        "Barbell Conventional Deadlift",
      ])
    );
    expect(names).not.toContain("Butterfly Fold");
  });

  it("gives yoga/pilates/mobility-only users nothing", () => {
    expect(selectCanonicalBasics(POOL, ["yoga", "mobility"])).toEqual([]);
  });

  it("treats no styles as eligible", () => {
    expect(selectCanonicalBasics(POOL, null).length).toBeGreaterThan(0);
  });
});

describe("pinExercises", () => {
  const menu = [ex("Butterfly Fold"), ex("Band-Assisted Pull-Up"), ex("Push-Up"), ex("Decline Push-Up")];

  it("puts requested pins first, then canonical, dedupes against the menu, and keeps the limit", () => {
    const out = pinExercises(
      menu,
      { requested: [ex("Strict Pull-Up")], canonical: [ex("Push-Up"), ex("Barbell Back Squat")] },
      5
    );
    expect(out.map((e) => e.name)).toEqual([
      "Strict Pull-Up",
      "Push-Up",
      "Barbell Back Squat",
      "Butterfly Fold",
      "Band-Assisted Pull-Up",
    ]);
    expect(out[0].pinned).toBe("requested");
    expect(out[1].pinned).toBe("canonical");
    expect(out[3].pinned).toBeUndefined();
  });

  it("treats plural/singular spellings of one movement as a single pin", () => {
    const out = pinExercises(
      [ex("Air Squats"), ex("Butterfly Fold")],
      { requested: [ex("Strict Pull-Ups"), ex("Air Squat")], canonical: [ex("Strict Pull-Up")] },
      200
    );
    expect(out.map((e) => e.name)).toEqual(["Strict Pull-Ups", "Air Squat", "Butterfly Fold"]);
  });

  it("returns the menu untouched (same reference) when there is nothing to pin", () => {
    expect(pinExercises(menu, { requested: [], canonical: [] }, 200)).toBe(menu);
  });

  it("caps pins at MAX_PINNED_EXERCISES", () => {
    const many = Array.from({ length: 40 }, (_, i) => ex(`Movement ${i}`));
    const out = pinExercises(menu, { requested: many, canonical: [] }, 200);
    expect(out.filter((e) => e.pinned)).toHaveLength(MAX_PINNED_EXERCISES);
  });
});

describe("formatGenerationMenu", () => {
  it("renders a flat list with no headings when nothing is pinned", () => {
    const out = formatGenerationMenu([ex("Push-Up"), ex("Row")]);
    expect(out).not.toContain("###");
    expect(out).toContain("- **Push-Up** (muscle groups: core; equipment: bodyweight; difficulty: moderate)");
  });

  it("leads with the requested and canonical sections when rows are pinned", () => {
    const out = formatGenerationMenu([
      { ...ex("Strict Pull-Up"), pinned: "requested" },
      { ...ex("Barbell Back Squat"), pinned: "canonical" },
      ex("Butterfly Fold"),
    ]);
    const req = out.indexOf("NAMED IN THE USER'S REQUEST");
    const canon = out.indexOf("CANONICAL LIFTS");
    const full = out.indexOf("FULL MENU");
    expect(req).toBeGreaterThanOrEqual(0);
    expect(canon).toBeGreaterThan(req);
    expect(full).toBeGreaterThan(canon);
    expect(out.indexOf("Strict Pull-Up")).toBeLessThan(out.indexOf("Butterfly Fold"));
  });
});

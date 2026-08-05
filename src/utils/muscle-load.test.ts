import { describe, it, expect } from "@jest/globals";
import {
  computeDayMuscleLoad,
  findNonFocusDominance,
  findConsecutiveMuscleOverlap,
  alignDaysToFocus,
  MuscleByExercise,
} from "@/utils/muscle-load";

const meta = (entries: Array<[string, string[]]>): MuscleByExercise => {
  const m = new Map<string, string[]>();
  for (const [name, muscles] of entries) m.set(name.toLowerCase(), muscles);
  return m;
};

const day = (dayNum: number, exercises: Array<{ name: string; sets: number }>, rounds = 1) => ({
  day: dayNum,
  blocks: [
    {
      blockType: rounds > 1 ? "circuit" : "traditional",
      rounds,
      exercises: exercises.map((e) => ({ exerciseName: e.name, sets: e.sets, reps: 10 })),
    },
  ],
});

describe("computeDayMuscleLoad [GQ-11]", () => {
  it("sums sets per major-mover muscle and excludes stabilizers (core)", () => {
    const m = meta([
      ["Bench Press", ["chest", "triceps", "core"]],
      ["Row", ["back", "biceps"]],
    ]);
    const load = computeDayMuscleLoad(day(1, [{ name: "Bench Press", sets: 4 }, { name: "Row", sets: 3 }]), m);
    expect(load.load.get("chest")).toBe(4); // primary, full weight
    expect(load.load.get("triceps")).toBe(2); // secondary, 0.5 weight
    expect(load.load.get("back")).toBe(3); // primary
    expect(load.load.get("biceps")).toBe(1.5); // secondary
    expect(load.load.has("core")).toBe(false); // stabilizer excluded
    expect(load.total).toBe(4 + 2 + 3 + 1.5);
  });

  it("weights circuit volume by rounds", () => {
    const m = meta([["Air Squat", ["quads", "glutes"]]]);
    const load = computeDayMuscleLoad(day(1, [{ name: "Air Squat", sets: 1 }], 3), m);
    expect(load.load.get("quads")).toBe(3); // 1 set × 3 rounds
  });
});

describe("findNonFocusDominance [GQ-11]", () => {
  it("flags a non-focus muscle carrying a big share", () => {
    const m = meta([
      ["Lateral Raise", ["shoulders"]],
      ["Curl", ["biceps"]],
    ]);
    // 10 shoulders + 4 biceps; focus is biceps. Shoulders = 10/14 = 71% non-focus.
    const load = computeDayMuscleLoad(day(1, [{ name: "Lateral Raise", sets: 10 }, { name: "Curl", sets: 4 }]), m);
    const findings = findNonFocusDominance(load, new Set(["biceps"]));
    expect(findings).toHaveLength(1);
    expect(findings[0].muscle).toBe("shoulders");
  });

  it("does not flag a muscle that IS the day's focus", () => {
    const m = meta([["Squat", ["quads", "glutes"]]]);
    const load = computeDayMuscleLoad(day(1, [{ name: "Squat", sets: 12 }]), m);
    expect(findNonFocusDominance(load, new Set(["quads", "glutes"]))).toHaveLength(0);
  });
});

describe("findConsecutiveMuscleOverlap [GQ-11]", () => {
  it("flags a muscle heavy on both calendar-adjacent days", () => {
    // Shoulders is the PRIMARY (first) mover on both days -> full weight, heavy.
    const m = meta([["Overhead Press", ["shoulders"]], ["Arnold Press", ["shoulders", "triceps"]]]);
    const d1 = computeDayMuscleLoad(day(1, [{ name: "Overhead Press", sets: 10 }]), m);
    const d2 = computeDayMuscleLoad(day(2, [{ name: "Arnold Press", sets: 10 }]), m);
    const findings = findConsecutiveMuscleOverlap([d1, d2], [[1, 2]]);
    expect(findings.some((f) => f.muscle === "shoulders")).toBe(true);
  });

  it("does not flag non-adjacent days", () => {
    const m = meta([["Press", ["shoulders"]]]);
    const d1 = computeDayMuscleLoad(day(1, [{ name: "Press", sets: 10 }]), m);
    const d3 = computeDayMuscleLoad(day(3, [{ name: "Press", sets: 10 }]), m);
    expect(findConsecutiveMuscleOverlap([d1, d3], [[1, 2]])).toHaveLength(0);
  });
});

describe("alignDaysToFocus [GQ-11 repair]", () => {
  const m = meta([
    ["Lateral Raise", ["shoulders"]], // off-focus filler on a back day
    ["Lat Pulldown", ["back", "biceps"]],
    ["Barbell Row", ["back"]],
    ["Face Pull", ["back", "shoulders"]],
    ["Bench Press", ["chest", "triceps"]],
  ]);
  // All fixtures are the same modality ("strength") so same-tag swaps fire.
  const tagStrength = (...names: string[]): Map<string, string> =>
    new Map(names.map((n) => [n.toLowerCase(), "strength"]));
  const allTags = tagStrength(
    "Lateral Raise",
    "Lat Pulldown",
    "Barbell Row",
    "Face Pull",
    "Bench Press",
    "Compound Row",
    "Overhead Press",
    "Row w/ Shrug"
  );
  const catalog = [
    { name: "Lat Pulldown", muscleGroups: ["back", "biceps"], tag: "strength" },
    { name: "Barbell Row", muscleGroups: ["back"], tag: "strength" },
    { name: "Face Pull", muscleGroups: ["back", "shoulders"], tag: "strength" },
  ];

  it("swaps an off-focus filler exercise for a focus-matching one", () => {
    const plan = [day(1, [{ name: "Lateral Raise", sets: 10 }, { name: "Barbell Row", sets: 4 }])];
    const res = alignDaysToFocus(plan, new Map([[1, ["back", "biceps"]]]), m, catalog, allTags);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].removed).toBe("Lateral Raise");
    expect(res.findings[0].overloadedMuscle).toBe("shoulders");
    const names = res.workoutPlan[0].blocks[0].exercises.map((e: any) => e.exerciseName);
    expect(names).not.toContain("Lateral Raise");
    expect(names).toContain("Lat Pulldown"); // hits focus, no shoulders
  });

  it("only swaps within the same modality (won't pull in a recovery item)", () => {
    const cm = meta([
      ["Lateral Raise", ["shoulders"]],
      ["Sauna Session", ["back"]], // tagged recovery, NOT a real back exercise
      ["Lat Pulldown", ["back", "biceps"]],
    ]);
    const cat = [
      { name: "Sauna Session", muscleGroups: ["back"], tag: "rehab" },
      { name: "Lat Pulldown", muscleGroups: ["back", "biceps"], tag: "strength" },
    ];
    const tags = new Map([
      ["lateral raise", "strength"],
      ["sauna session", "rehab"],
      ["lat pulldown", "strength"],
    ]);
    const plan = [day(1, [{ name: "Lateral Raise", sets: 10 }])];
    const res = alignDaysToFocus(plan, new Map([[1, ["back"]]]), cm, cat, tags);
    // Must pick the strength Lat Pulldown, never the rehab Sauna Session.
    expect(res.findings[0]?.replacement).toBe("Lat Pulldown");
  });

  it("focus-preserving swap: replaces a compound exercise loading a non-focus muscle with one that keeps the focus but drops that muscle", () => {
    const cm = meta([
      ["Compound Row", ["back", "shoulders"]],
      ["Lat Pulldown", ["back", "biceps"]],
    ]);
    const cat = [{ name: "Lat Pulldown", muscleGroups: ["back", "biceps"], tag: "strength" }];
    const plan = [day(1, [{ name: "Compound Row", sets: 20 }])]; // back 20, shoulders 10
    const res = alignDaysToFocus(plan, new Map([[1, ["back"]]]), cm, cat, allTags);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].removed).toBe("Compound Row");
    expect(res.findings[0].replacement).toBe("Lat Pulldown"); // keeps back, no shoulders
    expect(res.findings[0].overloadedMuscle).toBe("shoulders");
  });

  it("targets a non-focus muscle overlapping an adjacent day", () => {
    const cm = meta([
      ["Overhead Press", ["shoulders"]],
      ["Row w/ Shrug", ["back", "shoulders"]],
      ["Lat Pulldown", ["back", "biceps"]],
    ]);
    const cat = [{ name: "Lat Pulldown", muscleGroups: ["back", "biceps"], tag: "strength" }];
    const plan = [
      day(1, [{ name: "Overhead Press", sets: 20 }]),
      day(2, [{ name: "Row w/ Shrug", sets: 20 }]),
    ];
    const res = alignDaysToFocus(
      plan,
      new Map([[1, ["shoulders"]], [2, ["back"]]]),
      cm,
      cat,
      allTags,
      [],
      [[1, 2]]
    );
    const day2Fixed = res.findings.find((f) => f.dayNumber === 2);
    expect(day2Fixed?.overloadedMuscle).toBe("shoulders");
    expect(day2Fixed?.replacement).toBe("Lat Pulldown");
  });

  it("is a no-op for an already focus-aligned day", () => {
    const plan = [day(1, [{ name: "Barbell Row", sets: 5 }, { name: "Lat Pulldown", sets: 5 }])];
    const res = alignDaysToFocus(plan, new Map([[1, ["back", "biceps"]]]), m, catalog, allTags);
    expect(res.findings).toHaveLength(0);
    expect(res.workoutPlan[0]).toBe(plan[0]);
  });

  it("does not mutate the input plan", () => {
    const plan = [day(1, [{ name: "Lateral Raise", sets: 10 }, { name: "Barbell Row", sets: 4 }])];
    const before = JSON.parse(JSON.stringify(plan));
    alignDaysToFocus(plan, new Map([[1, ["back"]]]), m, catalog, allTags);
    expect(plan).toEqual(before);
  });
});

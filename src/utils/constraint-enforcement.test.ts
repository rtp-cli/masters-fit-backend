import { describe, it, expect } from "@jest/globals";
import {
  enforceAvoidConstraints,
  EnforcementCatalogItem,
} from "@/utils/constraint-enforcement";

const catalog: EnforcementCatalogItem[] = [
  { name: "Barbell Back Squat", muscleGroups: ["quads", "glutes"] },
  { name: "Goblet Squat", muscleGroups: ["quads", "glutes"] },
  { name: "Romanian Deadlift", muscleGroups: ["hamstrings", "glutes"] },
  { name: "Hip Thrust", muscleGroups: ["glutes", "hamstrings"] },
  { name: "Push-up", muscleGroups: ["chest", "triceps"] },
];

const day = (dayNum: number, names: string[]) => ({
  day: dayNum,
  blocks: [{ blockType: "traditional", exercises: names.map((n) => ({ exerciseName: n, sets: 3, reps: 8 })) }],
});

const namesIn = (plan: any[]) =>
  plan.flatMap((d) => (d.blocks || []).flatMap((b: any) => b.exercises.map((e: any) => e.exerciseName)));

describe("enforceAvoidConstraints [GQ-07]", () => {
  it("is a no-op when there are no avoid terms", () => {
    const plan = [day(1, ["Romanian Deadlift", "Push-up"])];
    const res = enforceAvoidConstraints(plan, [], [], catalog);
    expect(res.findings).toHaveLength(0);
    expect(namesIn(res.workoutPlan)).toEqual(["Romanian Deadlift", "Push-up"]);
  });

  it("swaps a banned exercise for a compliant catalog exercise sharing a muscle group", () => {
    const plan = [day(1, ["Romanian Deadlift", "Push-up"])];
    const res = enforceAvoidConstraints(plan, [], ["deadlift"], catalog);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].action).toBe("swapped");
    const replacement = res.findings[0].replacement!;
    // Replacement is a real catalog exercise, isn't a deadlift, and shares a
    // muscle group (hamstrings/glutes) with the removed RDL.
    const replItem = catalog.find((c) => c.name === replacement)!;
    expect(replItem).toBeDefined();
    expect(replacement.toLowerCase()).not.toContain("deadlift");
    expect((replItem.muscleGroups || []).some((m) => ["hamstrings", "glutes"].includes(m))).toBe(true);
    const names = namesIn(res.workoutPlan);
    expect(names).not.toContain("Romanian Deadlift");
    expect(names).toContain(replacement);
    // Sets/reps preserved from the swapped slot.
    expect(res.workoutPlan[0].blocks[0].exercises[0]).toMatchObject({ sets: 3, reps: 8 });
  });

  it("matches banned terms as substrings across variations", () => {
    const plan = [day(1, ["Single-Leg Deadlift Reach", "Barbell Back Squat"])];
    const res = enforceAvoidConstraints(plan, [], ["deadlift"], catalog);
    expect(namesIn(res.workoutPlan)).not.toContain("Single-Leg Deadlift Reach");
  });

  it("drops a banned exercise when no compliant catalog candidate remains", () => {
    // Only-catalog is a deadlift; nothing compliant to swap to.
    const onlyDeadlift: EnforcementCatalogItem[] = [
      { name: "Romanian Deadlift", muscleGroups: ["hamstrings"] },
    ];
    const plan = [day(1, ["Romanian Deadlift"])];
    const res = enforceAvoidConstraints(plan, [], ["deadlift"], onlyDeadlift);
    expect(res.findings[0].action).toBe("dropped");
    // Emptied block is removed.
    expect(res.workoutPlan[0].blocks).toHaveLength(0);
  });

  it("does not swap into an exercise already used on the day", () => {
    const plan = [day(1, ["Romanian Deadlift", "Hip Thrust"])];
    const res = enforceAvoidConstraints(plan, [], ["deadlift"], catalog);
    const names = namesIn(res.workoutPlan);
    // Hip Thrust already present -> swap must pick a different compliant exercise.
    expect(names.filter((n) => n === "Hip Thrust")).toHaveLength(1);
    expect(names).not.toContain("Romanian Deadlift");
  });

  it("drops invented exercises (exercisesToAdd) that match an avoid term", () => {
    const plan = [day(1, ["Push-up"])];
    const added = [{ name: "Trap Bar Deadlift", muscleGroups: ["hamstrings"] }];
    const res = enforceAvoidConstraints(plan, added, ["deadlift"], catalog);
    expect(res.exercisesToAdd).toHaveLength(0);
  });

  it("resets load/format fields on a swap so no phantom prescription carries over", () => {
    const plan = [
      {
        day: 1,
        blocks: [
          {
            blockType: "traditional",
            exercises: [
              { exerciseName: "Barbell Deadlift", sets: 4, reps: 5, weight: 185, duration: 0, distanceM: 0, restTime: 120 },
            ],
          },
        ],
      },
    ];
    const res = enforceAvoidConstraints(plan, [], ["deadlift"], catalog);
    const swapped = res.workoutPlan[0].blocks[0].exercises[0];
    expect(swapped.exerciseName.toLowerCase()).not.toContain("deadlift");
    expect(swapped.weight).toBe(0);
    expect(swapped.duration).toBe(0);
    expect(swapped.distanceM).toBe(0);
    expect(swapped.reps).toBe(5); // preserved (was > 0)
    expect(swapped.restTime).toBe(120); // structure preserved
  });

  it("ignores avoid terms shorter than 3 chars (blast-radius guard)", () => {
    const plan = [day(1, ["Cable Crossover", "Stability Ball Rollout"])];
    // "ab" would substring-match both if not filtered.
    const res = enforceAvoidConstraints(plan, [], ["ab"], catalog);
    expect(res.findings).toHaveLength(0);
    expect(namesIn(res.workoutPlan)).toEqual(["Cable Crossover", "Stability Ball Rollout"]);
  });

  it("handles multiple avoid terms", () => {
    const plan = [day(1, ["Romanian Deadlift", "Barbell Back Squat", "Push-up"])];
    const res = enforceAvoidConstraints(plan, [], ["deadlift", "barbell"], catalog);
    const names = namesIn(res.workoutPlan);
    expect(names.some((n) => n.toLowerCase().includes("deadlift"))).toBe(false);
    expect(names.some((n) => n.toLowerCase().includes("barbell"))).toBe(false);
  });
});

import { describe, it, expect } from "@jest/globals";
import {
  enforceBodyweightOnlyDays,
  isBodyweightEquipment,
} from "@/utils/equipment-per-day-enforcement";
import { EnforcementCatalogItem } from "@/utils/constraint-enforcement";

const day = (
  dayNum: number,
  exercises: Array<{ name: string; sets?: number }>
) => ({
  day: dayNum,
  blocks: [
    {
      blockType: "traditional",
      exercises: exercises.map((e) => ({
        exerciseName: e.name,
        sets: e.sets ?? 3,
        reps: 10,
      })),
    },
  ],
});

const catalog: EnforcementCatalogItem[] = [
  { name: "Barbell Bench Press", muscleGroups: ["chest"], equipment: ["barbell"] },
  { name: "Push-up", muscleGroups: ["chest"], equipment: ["bodyweight"] },
  { name: "Air Squat", muscleGroups: ["quads"], equipment: [] },
  { name: "Plank", muscleGroups: ["core"], equipment: ["none"] },
  { name: "Dumbbell Row", muscleGroups: ["back"], equipment: ["dumbbell"] },
  { name: "Inverted Row", muscleGroups: ["back"], equipment: ["bodyweight"] },
];

describe("isBodyweightEquipment [GQ-06]", () => {
  it("treats empty / bodyweight / none as bodyweight", () => {
    expect(isBodyweightEquipment([])).toBe(true);
    expect(isBodyweightEquipment(undefined)).toBe(true);
    expect(isBodyweightEquipment(["bodyweight"])).toBe(true);
    expect(isBodyweightEquipment(["none"])).toBe(true);
    expect(isBodyweightEquipment(["body weight"])).toBe(true);
  });
  it("treats real equipment as needing equipment", () => {
    expect(isBodyweightEquipment(["barbell"])).toBe(false);
    expect(isBodyweightEquipment(["dumbbell", "bench"])).toBe(false);
    // mixed: any real equipment item disqualifies
    expect(isBodyweightEquipment(["bodyweight", "barbell"])).toBe(false);
  });
});

describe("enforceBodyweightOnlyDays [GQ-06]", () => {
  it("swaps an equipment exercise on a flagged day for a bodyweight one (like muscle)", () => {
    const plan = [day(2, [{ name: "Barbell Bench Press" }])];
    const res = enforceBodyweightOnlyDays(plan, [], [2], catalog);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].action).toBe("swapped");
    expect(res.findings[0].exerciseName).toBe("Barbell Bench Press");
    const names = res.workoutPlan[0].blocks[0].exercises.map(
      (e: any) => e.exerciseName
    );
    expect(names).toContain("Push-up"); // bodyweight, same chest focus
    expect(names).not.toContain("Barbell Bench Press");
  });

  it("zeroes load on a swapped-in bodyweight exercise", () => {
    const plan = [
      day(1, [{ name: "Barbell Bench Press" }]),
    ];
    // give the source exercise a weight to prove it's cleared
    plan[0].blocks[0].exercises[0] = {
      ...plan[0].blocks[0].exercises[0],
      weight: 135,
    } as any;
    const res = enforceBodyweightOnlyDays(plan, [], [1], catalog);
    const swapped = res.workoutPlan[0].blocks[0].exercises[0];
    expect(swapped.weight).toBe(0);
  });

  it("leaves bodyweight exercises on a flagged day untouched", () => {
    const plan = [day(2, [{ name: "Push-up" }, { name: "Air Squat" }])];
    const res = enforceBodyweightOnlyDays(plan, [], [2], catalog);
    expect(res.findings).toHaveLength(0);
    expect(res.workoutPlan[0]).toEqual(plan[0]); // content unchanged (no swaps)
  });

  it("only touches flagged days, not other days", () => {
    const plan = [
      day(1, [{ name: "Barbell Bench Press" }]), // NOT flagged — keep equipment
      day(2, [{ name: "Dumbbell Row" }]), // flagged — must swap
    ];
    const res = enforceBodyweightOnlyDays(plan, [], [2], catalog);
    expect(
      res.workoutPlan[0].blocks[0].exercises[0].exerciseName
    ).toBe("Barbell Bench Press");
    const day2 = res.workoutPlan[1].blocks[0].exercises.map(
      (e: any) => e.exerciseName
    );
    expect(day2).toContain("Inverted Row"); // bodyweight back movement
  });

  it("drops an equipment exercise when no bodyweight swap is available", () => {
    const onlyEquip: EnforcementCatalogItem[] = [
      { name: "Barbell Bench Press", muscleGroups: ["chest"], equipment: ["barbell"] },
    ];
    const plan = [day(1, [{ name: "Barbell Bench Press" }])];
    const res = enforceBodyweightOnlyDays(plan, [], [1], onlyEquip);
    expect(res.findings[0].action).toBe("dropped");
    // block emptied by the drop -> removed
    expect(res.workoutPlan[0].blocks).toHaveLength(0);
  });

  it("uses inline equipment from exercisesToAdd for invented exercises", () => {
    const plan = [day(1, [{ name: "Invented Kettlebell Swing" }])];
    const added = [
      { name: "Invented Kettlebell Swing", muscleGroups: ["glutes"], equipment: ["kettlebell"] },
    ];
    const res = enforceBodyweightOnlyDays(plan, added, [1], catalog);
    expect(res.findings[0].action).toBe("swapped"); // needs equipment -> swapped
  });

  it("treats an unknown exercise (no equipment data) as compliant — never fabricates a swap", () => {
    const plan = [day(1, [{ name: "Totally Unknown Move" }])];
    const res = enforceBodyweightOnlyDays(plan, [], [1], catalog);
    expect(res.findings).toHaveLength(0);
  });

  it("is a no-op when no days are flagged", () => {
    const plan = [day(1, [{ name: "Barbell Bench Press" }])];
    const res = enforceBodyweightOnlyDays(plan, [], undefined, catalog);
    expect(res.findings).toHaveLength(0);
    expect(res.workoutPlan).toBe(plan);
  });

  it("does not mutate the input plan", () => {
    const plan = [day(2, [{ name: "Barbell Bench Press" }])];
    const before = JSON.parse(JSON.stringify(plan));
    enforceBodyweightOnlyDays(plan, [], [2], catalog);
    expect(plan).toEqual(before);
  });
});

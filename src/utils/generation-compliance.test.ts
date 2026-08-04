import { describe, it, expect } from "@jest/globals";
import {
  scoreWorkout,
  ExerciseMeta,
  ScoredWorkout,
  ComplianceCheck,
} from "@/utils/generation-compliance";

const meta = (
  entries: Array<[string, string[]]>
): Map<string, ExerciseMeta> => {
  const m = new Map<string, ExerciseMeta>();
  for (const [name, equipment] of entries) {
    m.set(name.toLowerCase(), { equipment, muscleGroups: [] });
  }
  return m;
};

const workout = (days: ScoredWorkout["workoutPlan"]): ScoredWorkout => ({
  workoutPlan: days,
});

describe("scoreWorkout [GQ-13]", () => {
  it("excludes: passes when the needle is absent, fails when present", () => {
    const w = workout([
      { day: 1, blocks: [{ exercises: [{ exerciseName: "Air Squat" }] }] },
      { day: 2, blocks: [{ exercises: [{ exerciseName: "Barbell Deadlift" }] }] },
    ]);
    const checks: ComplianceCheck[] = [
      { id: "a", label: "no deadlift", type: "excludes", needle: "deadlift" },
      { id: "b", label: "no burpee", type: "excludes", needle: "burpee" },
    ];
    const { results } = scoreWorkout(w, new Map(), checks);
    expect(results[0].passed).toBe(false);
    expect(results[1].passed).toBe(true);
  });

  it("excludesOnDay: only flags the named day", () => {
    const w = workout([
      { day: 1, blocks: [{ exercises: [{ exerciseName: "Romanian Deadlift" }] }] },
      { day: 2, blocks: [{ exercises: [{ exerciseName: "Push-up" }] }] },
    ]);
    const onDay2: ComplianceCheck = {
      id: "d2",
      label: "no deadlift on day 2",
      type: "excludesOnDay",
      dayNumber: 2,
      needle: "deadlift",
    };
    expect(scoreWorkout(w, new Map(), [onDay2]).results[0].passed).toBe(true);
    const onDay1: ComplianceCheck = { ...onDay2, id: "d1", dayNumber: 1 };
    expect(scoreWorkout(w, new Map(), [onDay1]).results[0].passed).toBe(false);
  });

  it("equipmentFreeDay: bodyweight (empty or 'bodyweight') passes, equipment fails", () => {
    const w = workout([
      {
        day: 1,
        blocks: [
          {
            exercises: [
              { exerciseName: "Push-up" }, // empty meta -> bodyweight
              { exerciseName: "Air Squat" }, // ["bodyweight"]
              { exerciseName: "Barbell Row" }, // ["barbells"] -> offender
            ],
          },
        ],
      },
    ]);
    const m = meta([
      ["air squat", ["bodyweight"]],
      ["barbell row", ["barbells"]],
    ]);
    const check: ComplianceCheck = {
      id: "e",
      label: "day 1 bodyweight",
      type: "equipmentFreeDay",
      dayNumber: 1,
    };
    const r = scoreWorkout(w, m, [check]).results[0];
    expect(r.passed).toBe(false);
    expect(r.score).toBeCloseTo(2 / 3);
  });

  it("blockTypeSomewhere / blockTypeAbsent / blockTypeEachDay", () => {
    const w = workout([
      { day: 1, blocks: [{ blockType: "amrap", exercises: [] }, { blockType: "traditional", exercises: [] }] },
      { day: 2, blocks: [{ blockType: "traditional", exercises: [] }] },
    ]);
    const somewhere: ComplianceCheck = { id: "s", label: "amrap somewhere", type: "blockTypeSomewhere", blockType: "amrap" };
    const absent: ComplianceCheck = { id: "ab", label: "no circuit", type: "blockTypeAbsent", blockType: "circuit" };
    const absentFail: ComplianceCheck = { id: "abf", label: "no amrap", type: "blockTypeAbsent", blockType: "amrap" };
    const eachDay: ComplianceCheck = { id: "ed", label: "amrap each day", type: "blockTypeEachDay", blockType: "amrap" };
    const res = scoreWorkout(w, new Map(), [somewhere, absent, absentFail, eachDay]).results;
    expect(res[0].passed).toBe(true); // somewhere
    expect(res[1].passed).toBe(true); // circuit absent
    expect(res[2].passed).toBe(false); // amrap present -> absent fails
    expect(res[3].score).toBeCloseTo(1 / 2); // amrap on 1 of 2 days
  });

  it("durationCompliance: scores fraction of days within tolerance", () => {
    const w = workout([
      { day: 1, blocks: [{ blockDurationMinutes: 44, exercises: [] }] },
      { day: 2, blocks: [{ blockDurationMinutes: 30, exercises: [] }] }, // 15 under target
    ]);
    const check: ComplianceCheck = {
      id: "dur",
      label: "45 ±5",
      type: "durationCompliance",
      targetMinutes: 45,
      toleranceMinutes: 5,
    };
    const r = scoreWorkout(w, new Map(), [check]).results[0];
    expect(r.score).toBeCloseTo(1 / 2);
    expect(r.passed).toBe(false);
  });

  it("noRepeatOverTwice: flags a 3rd occurrence in a day", () => {
    const thrice = { exerciseName: "Push-up" };
    const w = workout([
      { day: 1, blocks: [{ exercises: [thrice, thrice, thrice] }] },
    ]);
    const check: ComplianceCheck = { id: "nr", label: "no >2x", type: "noRepeatOverTwice" };
    expect(scoreWorkout(w, new Map(), [check]).results[0].passed).toBe(false);
  });

  it("overall is the mean of check scores", () => {
    const w = workout([
      { day: 1, blocks: [{ blockDurationMinutes: 45, exercises: [{ exerciseName: "Push-up" }] }] },
    ]);
    const checks: ComplianceCheck[] = [
      { id: "a", label: "no burpee", type: "excludes", needle: "burpee" }, // pass -> 1
      { id: "b", label: "no pushup", type: "excludes", needle: "push-up" }, // fail -> 0
    ];
    expect(scoreWorkout(w, new Map(), checks).overall).toBeCloseTo(0.5);
  });
});

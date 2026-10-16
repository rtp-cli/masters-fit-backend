import { describe, it, expect } from "@jest/globals";
import {
  buildPlanContext,
  findReferencedPlanDays,
  formatPlanContext,
  labelDate,
  referencedExerciseNames,
  PlanDayRowLike,
} from "./plan-context";

const exRow = (
  name: string,
  rx: Partial<{ sets: number; reps: number; weight: number; duration: number; distanceM: number; repsMin: number; repsMax: number }> = {}
) => ({
  sets: rx.sets ?? null,
  reps: rx.reps ?? null,
  repsMin: rx.repsMin ?? null,
  repsMax: rx.repsMax ?? null,
  weight: rx.weight ?? null,
  duration: rx.duration ?? null,
  distanceM: rx.distanceM ?? null,
  exercise: { name },
});

const day = (
  id: number,
  date: string,
  name: string,
  isComplete: boolean,
  blocks: PlanDayRowLike["blocks"] = []
): PlanDayRowLike => ({ id, date, name, isComplete, blocks });

// The prod 2026-10-16 shape: a Mon-Fri plan adjusted on Friday, with the
// Wednesday session never done.
const ROWS: PlanDayRowLike[] = [
  day(1, "2026-10-12", "Lower Body Strength", true, [
    {
      blockName: "Strength",
      blockType: "traditional",
      rounds: 1,
      timeCapMinutes: null,
      exercises: [exRow("Barbell Back Squat", { sets: 5, reps: 5, weight: 185 })],
    },
  ]),
  day(2, "2026-10-13", "Rest Day", false, []),
  day(3, "2026-10-14", "Upper Body Push + AMRAP", false, [
    {
      blockName: "Warm-Up",
      blockType: "warmup",
      rounds: 1,
      timeCapMinutes: null,
      exercises: [exRow("Arm Circles", { sets: 1, duration: 30 })],
    },
    {
      blockName: "Press Strength",
      blockType: "traditional",
      rounds: 1,
      timeCapMinutes: null,
      exercises: [
        exRow("Barbell Bench Press", { sets: 4, reps: 8, weight: 135 }),
        exRow("Dumbbell Shoulder Press", { sets: 3, repsMin: 8, repsMax: 12 }),
      ],
    },
    {
      blockName: "Finisher",
      blockType: "amrap",
      rounds: 1,
      timeCapMinutes: 12,
      exercises: [exRow("Push-Up", { sets: 1, reps: 10 }), exRow("Row", { sets: 1, distanceM: 250 })],
    },
  ]),
  day(4, "2026-10-15", "Conditioning", true, [
    {
      blockName: "Intervals",
      blockType: "circuit",
      rounds: 3,
      timeCapMinutes: null,
      exercises: [exRow("Burpee", { sets: 1, reps: 10 })],
    },
  ]),
  day(5, "2026-10-16", "Full Body", false, [
    {
      blockName: "Main",
      blockType: "traditional",
      rounds: 1,
      timeCapMinutes: null,
      exercises: [exRow("Kettlebell Swing", { sets: 3, reps: 15 })],
    },
  ]),
  day(6, "2026-10-19", "Pull Day", false, [
    {
      blockName: "Pull",
      blockType: "traditional",
      rounds: 1,
      timeCapMinutes: null,
      exercises: [exRow("Strict Pull-Up", { sets: 4, reps: 6 })],
    },
  ]),
];

const ctx = buildPlanContext({ id: 5, date: "2026-10-16" }, ROWS);

describe("labelDate", () => {
  it("prefixes the weekday computed from the date itself (no timezone drift)", () => {
    expect(labelDate("2026-10-14")).toBe("Wed 2026-10-14");
    expect(labelDate("2026-10-16")).toBe("Fri 2026-10-16");
  });
});

describe("formatPlanContext", () => {
  const text = formatPlanContext(ctx);

  it("lists every plan day with weekday, name and status", () => {
    expect(text).toContain("THIS DAY (the day being adjusted): Fri 2026-10-16.");
    expect(text).toContain("- Mon 2026-10-12 · Lower Body Strength · done");
    expect(text).toContain("- Tue 2026-10-13 · Rest Day · rest day");
    expect(text).toContain("- Wed 2026-10-14 · Upper Body Push + AMRAP · MISSED");
    expect(text).toContain("- Fri 2026-10-16 · Full Body · THIS DAY");
    expect(text).toContain("- Mon 2026-10-19 · Pull Day · upcoming");
  });

  it("renders blocks with exercise names and compact prescriptions", () => {
    expect(text).toContain(
      "  Press Strength [traditional]: Barbell Bench Press 4x8 @135; Dumbbell Shoulder Press 3x8-12"
    );
    expect(text).toContain("  Finisher [amrap, 12min cap]: Push-Up 10; Row 250m");
    expect(text).toContain("  Warm-Up [warmup]: Arm Circles 30s");
    expect(text).toContain("  Intervals [circuit, 3 rounds]: Burpee 10");
    // today's current workout is included too
    expect(text).toContain("  Main [traditional]: Kettlebell Swing 3x15");
  });

  it("names the resolved referenced day when given one", () => {
    const withRef = formatPlanContext(ctx, [ctx.days[2]]);
    expect(withRef).toContain(
      "Days the request mentions (resolved from its wording): Wed 2026-10-14 (Upper Body Push + AMRAP)."
    );
  });

  it("stays small — a week's plan is well under 2k characters", () => {
    expect(text.length).toBeLessThan(2000);
  });
});

describe("buildPlanContext", () => {
  it("keeps only days within the window around the adjusted day, sorted by date", () => {
    const far = buildPlanContext({ id: 5, date: "2026-10-16" }, [
      day(9, "2026-09-01", "Ancient", true, []),
      ...ROWS.slice().reverse(),
      day(10, "2026-11-30", "Far Future", false, []),
    ]);
    expect(far.days.map((d) => d.planDayId)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

const refs = (request: string) =>
  findReferencedPlanDays(request, ctx).map((d) => d.date);

describe("findReferencedPlanDays", () => {
  it("resolves the prod request to this past Wednesday", () => {
    expect(
      refs(
        "Replace today's workout with the workout from this past Wednesday that I was unable to do."
      )
    ).toEqual(["2026-10-14"]);
  });

  it("resolves weekday possessives and yesterday relative to the adjusted day", () => {
    expect(refs("Give me Wednesday's workout")).toEqual(["2026-10-14"]);
    expect(refs("redo yesterday's session")).toEqual(["2026-10-15"]);
    expect(refs("same as last Monday")).toEqual(["2026-10-12"]);
  });

  it("prefers the upcoming day when the request says next", () => {
    expect(refs("swap in next Monday's workout")).toEqual(["2026-10-19"]);
  });

  it("falls back to the most recent missed day for 'the one I missed'", () => {
    expect(refs("do the one I missed instead")).toEqual(["2026-10-14"]);
    expect(refs("I want the workout I couldn't do earlier this week")).toEqual(["2026-10-14"]);
  });

  it("resolves an explicit ISO date", () => {
    expect(refs("use the 2026-10-12 workout")).toEqual(["2026-10-12"]);
  });

  it("returns nothing for requests that don't reference another day", () => {
    expect(refs("make it harder")).toEqual([]);
    expect(refs("I didn't sleep well, make it easier")).toEqual([]);
    // a rest day has nothing to reproduce
    expect(refs("Tuesday's workout please")).toEqual([]);
    // the day being adjusted is never its own reference
    expect(refs("Friday but harder")).toEqual([]);
  });
});

describe("referencedExerciseNames", () => {
  it("lists the referenced days' exercise names in plan order, deduped", () => {
    expect(referencedExerciseNames([ctx.days[2], ctx.days[2]])).toEqual([
      "Arm Circles",
      "Barbell Bench Press",
      "Dumbbell Shoulder Press",
      "Push-Up",
      "Row",
    ]);
  });
});

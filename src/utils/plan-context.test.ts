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
    const withRef = formatPlanContext(ctx, { days: [ctx.days[2]], unresolved: [] });
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

const resolveRefs = (request: string) => {
  const { days, unresolved } = findReferencedPlanDays(request, ctx);
  return { days: days.map((d) => d.date), unresolved };
};
const refs = (request: string) => {
  const { days, unresolved } = resolveRefs(request);
  expect(unresolved).toEqual([]);
  return days;
};

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
    expect(resolveRefs("make it harder")).toEqual({ days: [], unresolved: [] });
    expect(resolveRefs("I didn't sleep well, make it easier")).toEqual({ days: [], unresolved: [] });
    // the day being adjusted is never its own reference
    expect(resolveRefs("Friday but harder")).toEqual({ days: [], unresolved: [] });
    expect(resolveRefs("make 2026-10-16 harder")).toEqual({ days: [], unresolved: [] });
  });

  // Local QA, plan with no Sunday: the missed-day fallback used to fire and
  // silently hand the user Tuesday's (here: Wednesday's) workout.
  it("never falls back to a missed day when a named weekday isn't in the plan", () => {
    expect(resolveRefs("Replace today's workout with the Sunday workout I couldn't do.")).toEqual({
      days: [],
      unresolved: ["Sunday"],
    });
    expect(
      resolveRefs("Replace today's workout with the workout from this past Sunday that I was unable to do.")
    ).toEqual({ days: [], unresolved: ["Sunday"] });
  });

  it("reports an ISO date with no plan workout as unresolved, without a fallback", () => {
    expect(resolveRefs("give me the 2026-10-11 workout I missed")).toEqual({
      days: [],
      unresolved: ["Sun 2026-10-11"],
    });
  });

  it("reports a rest day or empty yesterday as unresolved", () => {
    expect(resolveRefs("Tuesday's workout please").unresolved).toEqual(["Tuesday"]);
    const satCtx = buildPlanContext({ id: 6, date: "2026-10-19" }, ROWS);
    expect(findReferencedPlanDays("redo yesterday's workout", satCtx)).toEqual({
      days: [],
      unresolved: ["yesterday (Sun 2026-10-18)"],
    });
  });

  it("flags 'the one I missed' as unresolved when nothing was missed", () => {
    const allDone = buildPlanContext(
      { id: 5, date: "2026-10-16" },
      ROWS.map((r) => (r.id === 3 ? { ...r, isComplete: true } : r))
    );
    expect(findReferencedPlanDays("do the one I missed", allDone)).toEqual({
      days: [],
      unresolved: ["missed"],
    });
  });
});

describe("formatPlanContext unresolved references", () => {
  it("states firmly that the named day has no workout and must not be substituted", () => {
    const text = formatPlanContext(
      ctx,
      findReferencedPlanDays("the workout from this past Sunday that I was unable to do", ctx)
    );
    expect(text).toContain(
      "The request mentions Sunday, but this plan has NO Sunday workout in range. Do NOT substitute a different day; build a fresh workout and say plainly in the description that no Sunday workout was found."
    );
    expect(text).not.toContain("Days the request mentions (resolved");
  });

  it("words the nothing-missed case readably", () => {
    const text = formatPlanContext(ctx, { days: [], unresolved: ["missed"] });
    expect(text).toContain(
      "The request mentions a missed workout, but this plan has NO missed workout in range."
    );
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

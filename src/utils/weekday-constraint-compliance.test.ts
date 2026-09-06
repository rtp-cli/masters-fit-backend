import { describe, it, expect } from "@jest/globals";
import { checkWeekdayConstraintCompliance } from "@/utils/weekday-constraint-compliance";
import type { PlanDaySlot } from "@/utils/plan-schedule";

// The real schedule from the 2026-09-03 prod incident (user 3): six available
// days, Sunday excluded.
const SCHEDULE: PlanDaySlot[] = [
  { dayNumber: 1, weekday: "thursday", date: "2026-09-03" },
  { dayNumber: 2, weekday: "friday", date: "2026-09-04" },
  { dayNumber: 3, weekday: "saturday", date: "2026-09-05" },
  { dayNumber: 4, weekday: "monday", date: "2026-09-07" },
  { dayNumber: 5, weekday: "tuesday", date: "2026-09-08" },
  { dayNumber: 6, weekday: "wednesday", date: "2026-09-09" },
];

// Constraints as the planner ACTUALLY extracted them on 9/3 (both runs got
// these right).
const MUST = [
  "Thursday (Day 1) must be Wendler 531 Week 1 bench press as the strength block, followed by a CrossFit-style METCON circuit",
  "Saturday (Day 3) must be Wendler 531 Week 1 squat as the strength block, followed by a CrossFit-style METCON circuit",
  "Monday (Day 4) must be Wendler 531 Week 1 deadlift as the strength block, followed by a CrossFit-style METCON circuit",
  "Friday (Day 2), Tuesday (Day 5), and Wednesday (Day 6) must be light recovery sessions",
];

const day = (name: string, focus: string) => ({
  day: 0, // renumbering happens post-loop; the check indexes by position
  name,
  focus,
  primaryMuscleGroups: [],
  styles: [],
});

// The COMPLIANT plan (run 793 — what the correct run emitted).
const GOOD_DAYS = [
  day("Wendler 531 Bench Press + CrossFit METCON", "Upper body pressing strength"),
  day("Recovery: Upper Body & Core", "Light recovery session"),
  day("Wendler 531 Squat + CrossFit METCON", "Lower body strength"),
  day("Wendler 531 Deadlift + CrossFit METCON", "Posterior chain strength"),
  day("Recovery: Cardio & Core", "Light recovery session"),
  day("Recovery: Full-Body Mobility & Conditioning", "Light full-body recovery"),
];

// The VIOLATING plan (run 794 — what the user actually got): squat on Day 2
// (Friday), deadlift on Day 5 (Tuesday), recovery where the lifts belonged.
const BAD_DAYS = [
  day("Wendler 531 Bench Press + CrossFit METCON", "Upper body strength"),
  day("Wendler 531 Squat + CrossFit METCON", "Lower body strength"),
  day("Recovery: Upper Body & Core", "Light upper body work"),
  day("Recovery: Cardio & Core", "Light cardio conditioning"),
  day("Wendler 531 Deadlift + CrossFit METCON", "Full-body strength"),
  day("Recovery: Full-Body Mobility & Stability", "Light full-body movement"),
];

describe("checkWeekdayConstraintCompliance [P1-a]", () => {
  it("passes the compliant 9/3 plan (run 793)", () => {
    const violations = checkWeekdayConstraintCompliance(
      { days: GOOD_DAYS, constraints: { must: MUST, avoid: [] } },
      SCHEDULE
    );
    expect(violations).toHaveLength(0);
  });

  it("flags the scrambled 9/3 plan (run 794): squat and deadlift on the wrong weekdays", () => {
    const violations = checkWeekdayConstraintCompliance(
      { days: BAD_DAYS, constraints: { must: MUST, avoid: [] } },
      SCHEDULE
    );
    const violatedWeekdays = violations.map((v) => v.weekday).sort();
    // Saturday should be squat (got recovery), Monday should be deadlift (got
    // recovery), Friday and Tuesday should be recovery (got lifts).
    expect(violatedWeekdays).toContain("saturday");
    expect(violatedWeekdays).toContain("monday");
    expect(violatedWeekdays).toContain("friday");
    expect(violatedWeekdays).toContain("tuesday");
  });

  it("returns no violations when there are no constraints", () => {
    expect(
      checkWeekdayConstraintCompliance({ days: GOOD_DAYS }, SCHEDULE)
    ).toHaveLength(0);
    expect(
      checkWeekdayConstraintCompliance(
        { days: GOOD_DAYS, constraints: { must: [], avoid: [] } },
        SCHEDULE
      )
    ).toHaveLength(0);
  });

  it("skips rules that mention no weekday", () => {
    const violations = checkWeekdayConstraintCompliance(
      {
        days: GOOD_DAYS,
        constraints: { must: ["every session must include core work"], avoid: [] },
      },
      SCHEDULE
    );
    expect(violations).toHaveLength(0);
  });

  it("skips a weekday that isn't scheduled this week", () => {
    const violations = checkWeekdayConstraintCompliance(
      {
        days: GOOD_DAYS,
        constraints: {
          must: ["Sunday must be a long run"],
          avoid: [],
        },
      },
      SCHEDULE
    );
    expect(violations).toHaveLength(0);
  });

  it("is lenient: any content token matching the day passes the rule", () => {
    // "recovery" appears in Friday's name, so this passes even though
    // "pull-ups" doesn't appear.
    const violations = checkWeekdayConstraintCompliance(
      {
        days: GOOD_DAYS,
        constraints: {
          must: ["Friday must be a recovery session with pull-ups"],
          avoid: [],
        },
      },
      SCHEDULE
    );
    expect(violations).toHaveLength(0);
  });

  it("handles plural weekday mentions (\"Fridays\")", () => {
    const violations = checkWeekdayConstraintCompliance(
      {
        days: BAD_DAYS,
        constraints: {
          must: ["keep Fridays as light recovery"],
          avoid: [],
        },
      },
      SCHEDULE
    );
    // BAD_DAYS has the squat day on Friday — violation.
    expect(violations).toHaveLength(1);
    expect(violations[0].weekday).toBe("friday");
  });

  it("skips a short week's missing day rather than crashing", () => {
    const violations = checkWeekdayConstraintCompliance(
      { days: GOOD_DAYS.slice(0, 2), constraints: { must: MUST, avoid: [] } },
      SCHEDULE
    );
    // Days 3+ absent — those rules are skipped (day-count check handles it);
    // days 1-2 are compliant.
    expect(violations).toHaveLength(0);
  });
});

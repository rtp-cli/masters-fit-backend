import { describe, it, expect } from "@jest/globals";
import {
  roundUpToPlate,
  detectPercentScheme,
  parseOneRepMaxes,
  liftForExerciseName,
  applyPercentSchemeLoads,
  roundBarbellLoads,
  stripNumericSentences,
} from "./percent-scheme-loads";

const RICH_REQUEST = `This week:
Monday: Wendler 531 Week 1 bench press, including warm-up sets based on a 1RM of 235# + CrossFit-style METCON circuit

Tuesday: 10 RFT: 1. 6x strict pull-ups; 2. 15x push-ups; 3. 20x air squats; 4. 20x sit-ups

Wednesday: Wendler 531 Week 1 squat, including warm-up sets based on a 1RM of 285# + CrossFit-style METCON circuit

Friday: Wendler 531 Week 1 deadlift, including warm-up sets based on a 1RM of 375# + CrossFit-style METCON circuit`;

const CATALOG = [
  { name: "Barbell Bench Press", equipment: ["barbells", "bench"] },
  { name: "Barbell Back Squat", equipment: ["barbells", "squat_rack"] },
  { name: "Barbell Conventional Deadlift", equipment: ["barbells"] },
  { name: "Barbell Front Squat", equipment: ["barbells"] },
  { name: "Dumbbell Bench Press", equipment: ["dumbbells"] },
  { name: "Kettlebell Swing", equipment: ["kettlebells"] },
];

const entry = (exerciseName: string, weight: number, reps = 5, extra: any = {}) => ({
  exerciseName,
  sets: 1,
  reps,
  weight,
  restTime: 90,
  ...extra,
});

describe("roundUpToPlate", () => {
  it("ceils to 5 lb and leaves multiples alone", () => {
    expect(roundUpToPlate(106)).toBe(110);
    expect(roundUpToPlate(127)).toBe(130);
    expect(roundUpToPlate(137)).toBe(140);
    expect(roundUpToPlate(85)).toBe(85);
    expect(roundUpToPlate(84.6)).toBe(85);
    expect(roundUpToPlate(202.5)).toBe(205);
  });
});

describe("detectPercentScheme", () => {
  it("recognises Wendler spellings and the week", () => {
    expect(detectPercentScheme(RICH_REQUEST)?.week).toBe(1);
    expect(detectPercentScheme("5/3/1 week 3 squat")?.week).toBe(3);
    expect(detectPercentScheme("Wendler deload week")?.week).toBe(4);
    expect(detectPercentScheme("Wendler squat + metcon")?.week).toBe(1); // default
  });
  it("ignores unrelated requests", () => {
    expect(detectPercentScheme("heavy legs then a 12 min amrap")).toBeNull();
    expect(detectPercentScheme(null)).toBeNull();
  });
});

describe("parseOneRepMaxes", () => {
  it("attributes each stated 1RM to the lift named on the same line", () => {
    const m = parseOneRepMaxes(RICH_REQUEST);
    expect(m.get("bench")).toBe(235);
    expect(m.get("squat")).toBe(285);
    expect(m.get("deadlift")).toBe(375);
    expect(m.has("press")).toBe(false);
  });
  it("accepts number-first phrasing and 'one-rep max'", () => {
    expect(parseOneRepMaxes("Squat day. 315 lb 1RM.").get("squat")).toBe(315);
    expect(parseOneRepMaxes("bench press, one-rep max of 200 pounds").get("bench")).toBe(200);
  });
  it("splits a single-line, sentence-separated request even after ALL-CAPS words", () => {
    const oneLine =
      "This week: Monday: Wendler 531 Week 1 bench press, including warm-up sets based on 1RM of 235# + short CrossFit-style METCON. Wednesday: Wendler 531 Week 1 squat, including warm-up sets based on 1RM of 285# + METCON. Friday: Wendler 531 Week 1 deadlift, including warm-up sets based on 1RM of 375# + METCON.";
    const m = parseOneRepMaxes(oneLine);
    expect([...m]).toEqual([["bench", 235], ["squat", 285], ["deadlift", 375]]);
  });

  it("refuses to guess when a segment names two lifts", () => {
    expect(parseOneRepMaxes("bench and squat, 1RM of 235").size).toBe(0);
  });
});

describe("liftForExerciseName", () => {
  it("maps the barbell canon and rejects variants", () => {
    expect(liftForExerciseName("Barbell Bench Press")).toBe("bench");
    expect(liftForExerciseName("Dumbbell Bench Press")).toBeNull();
    expect(liftForExerciseName("Barbell Back Squat")).toBe("squat");
    expect(liftForExerciseName("Barbell Front Squat")).toBeNull();
    expect(liftForExerciseName("Air Squat")).toBeNull();
    expect(liftForExerciseName("Barbell Conventional Deadlift")).toBe("deadlift");
    expect(liftForExerciseName("Dumbbell Romanian Deadlift")).toBeNull();
  });
});

describe("applyPercentSchemeLoads", () => {
  const plan = [
    {
      day: 1,
      blocks: [
        {
          blockType: "traditional",
          blockName: "Wendler 531 Week 1 Bench Press",
          instructions: "Warm-ups at 40/50/60% of training max (211 lbs), then 65/75/85%.",
          exercises: [85, 106, 127, 137, 158, 179].map((w) => entry("Barbell Bench Press", w)),
        },
        {
          blockType: "amrap",
          exercises: [entry("Dumbbell Bench Press", 50, 8), entry("Kettlebell Swing", 53, 15)],
        },
      ],
    },
    {
      day: 3,
      blocks: [
        {
          blockType: "traditional",
          // The model's squat arithmetic was off a ~380 lb TM (341 > the 285 1RM).
          exercises: [153, 191, 229, 256, 298, 341].map((w) => entry("Barbell Back Squat", w)),
        },
      ],
    },
    {
      day: 5,
      blocks: [
        {
          blockType: "traditional",
          instructions: "Perform warm-up sets (211, 211, 211 lbs respectively), then working sets (274, 316, 358 lbs).",
          // Two-entry stub with Monday's bench TM copied in.
          exercises: [entry("Barbell Conventional Deadlift", 211), entry("Barbell Conventional Deadlift", 211)],
        },
      ],
    },
  ];

  const { workoutPlan, findings } = applyPercentSchemeLoads(plan, RICH_REQUEST, CATALOG);
  const loads = (d: number, b = 0) => workoutPlan.find((x: any) => x.day === d).blocks[b].exercises.map((e: any) => e.weight);

  it("rounds a correct bench ladder up to plate math", () => {
    expect(loads(1)).toEqual([85, 110, 130, 140, 160, 180]);
  });
  it("replaces a wrong squat ladder with the real one (TM 256.5)", () => {
    expect(loads(3)).toEqual([105, 130, 155, 170, 195, 220]);
  });
  it("expands a two-entry deadlift stub to the full six-set ladder (TM 337.5)", () => {
    expect(loads(5)).toEqual([135, 170, 205, 220, 255, 290]);
    const reps = workoutPlan[2].blocks[0].exercises.map((e: any) => e.reps);
    expect(reps).toEqual([5, 5, 3, 5, 5, 5]);
  });
  it("drops the model's numeric sentences from block instructions and states the whole ladder once", () => {
    const instr: string = workoutPlan[2].blocks[0].instructions;
    expect(instr).not.toContain("211");
    expect(instr).not.toContain("358");
    expect(instr).toContain("TM 337.5 lb = 90% of 375 1RM");
    expect(instr).toContain("warm-up 135×5, 170×5, 205×3; working 220×5, 255×5, 290×5+");
  });

  it("leaves no dangling fragments when a sentence mixed prose with numbers (workout 847 Monday)", () => {
    const monday = [
      {
        day: 1,
        blocks: [
          {
            blockType: "traditional",
            instructions:
              "Complete all warm-up and working sets in prescribed order. Training max = 90% of 1RM = 211.5 lb, round to 5 lb. Week 1 percentages: 65%, 75%, 85% of training max for 5, 3, 1+ reps respectively. Rest 2-3 minutes between working sets.",
            exercises: [entry("Barbell Bench Press", 85), entry("Barbell Bench Press", 106)],
          },
        ],
      },
    ];
    const instr: string = applyPercentSchemeLoads(monday, RICH_REQUEST, CATALOG).workoutPlan[0].blocks[0].instructions;
    expect(instr).not.toContain("=,");
    expect(instr).not.toContain("round to");
    expect(instr).not.toContain("5, 3, 1+"); // the model's wrong (Week 3) rep scheme is gone
    expect(instr).toContain("Complete all warm-up and working sets in prescribed order.");
    expect(instr).toContain("Rest 2-3 minutes between working sets.");
    expect(instr).toContain("working 140×5, 160×5, 180×5+");
  });
  it("leaves non-ladder blocks and non-barbell implements alone", () => {
    expect(loads(1, 1)).toEqual([50, 53]);
  });
  it("reports one finding per rebuilt lift with before/after loads", () => {
    expect(findings.map((f) => [f.lift, f.oneRepMax, f.trainingMax])).toEqual([
      ["bench", 235, 211.5],
      ["squat", 285, 256.5],
      ["deadlift", 375, 337.5],
    ]);
    expect(findings[2].before).toEqual([211, 211]);
  });
  it("is a no-op without a recognised program or without 1RMs", () => {
    expect(applyPercentSchemeLoads(plan, "Wendler squat day, go heavy", CATALOG).workoutPlan).toBe(plan);
    expect(applyPercentSchemeLoads(plan, "heavy squat, 1RM of 285", CATALOG).workoutPlan).toBe(plan);
  });
  it("does not touch a front squat when the 1RM is for the back squat", () => {
    const fs = [{ day: 1, blocks: [{ blockType: "traditional", exercises: [entry("Barbell Front Squat", 153)] }] }];
    expect(applyPercentSchemeLoads(fs, RICH_REQUEST, CATALOG).findings).toEqual([]);
  });
});

describe("roundBarbellLoads", () => {
  it("ceils barbell loads anywhere in the plan and leaves other implements", () => {
    const plan = [
      {
        day: 1,
        blocks: [
          { blockType: "amrap", exercises: [entry("Barbell Back Squat", 132, 10), entry("Kettlebell Swing", 53, 15), entry("Dumbbell Bench Press", 47.5, 8)] },
        ],
      },
    ];
    const { workoutPlan, findings } = roundBarbellLoads(plan, CATALOG);
    expect(workoutPlan[0].blocks[0].exercises.map((e: any) => e.weight)).toEqual([135, 53, 47.5]);
    expect(findings).toEqual([{ dayNumber: 1, exerciseName: "Barbell Back Squat", from: 132, to: 135 }]);
  });
  it("returns the same reference when nothing needs rounding", () => {
    const plan = [{ day: 1, blocks: [{ exercises: [entry("Barbell Back Squat", 135)] }] }];
    expect(roundBarbellLoads(plan, CATALOG).workoutPlan).toBe(plan);
  });
});

describe("stripNumericSentences", () => {
  it("keeps cue sentences and removes load / percent / rep-scheme sentences", () => {
    const out = stripNumericSentences(
      "Brace hard. Warm-ups at 40%, 50%, 60%. Use 135 lbs then 185 lbs. Do 5, 3, 1+ reps. Neutral spine throughout."
    );
    expect(out).toBe("Brace hard. Neutral spine throughout.");
  });
  it("handles empty input", () => {
    expect(stripNumericSentences("")).toBe("");
  });
});

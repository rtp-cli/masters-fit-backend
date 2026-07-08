/**
 * Seed a believable DEMO USER ("Dave Walker") with several weeks of realistic
 * workout history, for marketing screenshots from the simulator.
 *
 * SAFE BY DESIGN: refuses to run against a non-local DATABASE_URL unless you
 * pass --remote. Even then, only the demo user is ever deleted/created — no
 * other users are touched. Idempotent: wipes the demo user first, then reseeds.
 *
 * Usage:
 *   npx tsx src/scripts/seed-demo-user.ts            # local DB
 *   npx tsx src/scripts/seed-demo-user.ts --delete   # remove the demo user only
 *   DATABASE_URL=<neon-url> npx tsx src/scripts/seed-demo-user.ts --remote
 *                                                    # seed a non-local DB (e.g. Neon)
 */

import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { profiles } from "@/models/profile.schema";
import { prompts } from "@/models/prompts.schema";
import {
  workouts,
  planDays,
  workoutBlocks,
  planDayExercises,
} from "@/models/workout.schema";
import {
  exerciseLogs,
  exerciseSetLogs,
  planDayLogs,
  workoutLogs,
} from "@/models/logs.schema";
import { userSubscriptions, trialUsage } from "@/models/subscription.schema";
import { backgroundJobs } from "@/models/jobs.schema";
import { exercises } from "@/models/exercise.schema";
import { SubscriptionStatus } from "@/constants";
import { CURRENT_WAIVER_VERSION } from "@/constants/waiver";
import {
  FitnessGoals,
  FitnessLevels,
  IntensityLevels,
  WorkoutEnvironments,
  PreferredStyles,
  PreferredDays,
  Gender,
  AvailableEquipment,
  getEquipmentForEnvironment,
} from "@/constants/profile";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------
const DEMO_EMAIL = "rtp+demo@mastersfit.ai";
const DEMO_NAME = "Dave Walker";
// Anchored to the current UTC date so the demo never goes stale: the active
// week's final session lands on TODAY (left as the in-progress workout) and
// everything before it is complete — giving a live streak that always includes
// "today's" pending workout.
const TODAY = new Date().toISOString().split("T")[0];

function assertLocalDatabase(allowRemote: boolean) {
  const url = process.env.DATABASE_URL || "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    console.error("DATABASE_URL is unset or unparseable. Aborting.");
    process.exit(1);
  }
  const isLocal = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  console.log(`DATABASE_URL host: ${host} (local=${isLocal})`);
  if (!isLocal) {
    if (!allowRemote) {
      console.error(
        `Refusing to seed: host "${host}" is not local. This script is ` +
          `LOCAL-ONLY by default.\n` +
          `Re-run with --remote to seed a non-local database (e.g. Neon). Only ` +
          `the demo user (${DEMO_EMAIL}) is ever deleted/created.`
      );
      process.exit(1);
    }
    console.warn(
      `⚠️  --remote: seeding NON-LOCAL database "${host}". ` +
        `Deleting + recreating only the demo user (${DEMO_EMAIL}).`
    );
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}
/** A timestamp at ~6:30pm on the given date (when the workout was "done"). */
function eveningOf(dateStr: string): Date {
  return new Date(dateStr + "T18:30:00Z");
}

// ---------------------------------------------------------------------------
// Exercise library — resolved by NAME at runtime (see resolveExerciseIds
// below), not hardcoded IDs. IDs drift between local and remote databases
// (local's curated ~100-row catalog vs. production's much larger one grown
// from real usage), so a hardcoded ID map silently pointed at the wrong
// exercise on whichever DB it wasn't verified against.
// ---------------------------------------------------------------------------
// Each entry is a list of acceptable names, tried in order — the catalog's
// exact wording (and even which variant exists at all) differs between local
// and production, so the first candidate found on whichever DB is running
// wins. Fallback candidates are the plainest/most generic variant available.
const EX_NAMES: Record<string, string[]> = {
  armCircles: ["Arm Circles"],
  legSwings: ["Leg Swings", "Standing Leg Swings"],
  hipCircles: ["Hip Circles"],
  bandPullApart: ["Band Pull-Apart"],
  gobletSquat: ["Goblet Squat"], // weighted (kettlebells)
  dumbbellRow: ["Dumbbell Row", "Dumbbell Rows"], // weighted (dumbbells)
  inclinePress: ["Incline Dumbbell Press"], // weighted (dumbbells)
  benchPress: ["Barbell Bench Press"], // weighted
  airSquat: ["Air Squat", "Air Squats"],
  pushUp: ["Push-Up"],
  ringRow: ["Ring Row"],
  tricepDips: ["Tricep Dips"],
  kettlebellSwing: ["Kettlebell Swing"],
  burpee: ["Burpee"],
  boxJump: ["Box Jump"],
  hamstringStretch: ["Hamstring Stretch", "Standing Hamstring Stretch"],
  chestStretch: ["Chest Stretch", "Standing Chest Stretch"],
  childsPose: ["Child's Pose", "Childs Pose"],
};

// Populated by resolveExerciseIds() in run(), before deleteDemoUser/seed use it.
let EX: Record<keyof typeof EX_NAMES, number>;

async function resolveExerciseIds(): Promise<void> {
  const allCandidates = Object.values(EX_NAMES).flat();
  const rows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(inArray(exercises.name, allCandidates));
  const byName = new Map(rows.map((r) => [r.name, r.id]));

  const missing: string[] = [];
  const resolved = {} as Record<keyof typeof EX_NAMES, number>;
  for (const [key, candidates] of Object.entries(EX_NAMES) as [
    keyof typeof EX_NAMES,
    string[],
  ][]) {
    const found = candidates.find((name) => byName.has(name));
    if (found === undefined) {
      missing.push(candidates.join(" / "));
    } else {
      resolved[key] = byName.get(found)!;
    }
  }
  if (missing.length) {
    console.error(
      `Aborting: this database's exercises table has none of the accepted ` +
        `name(s) for ${missing.length} exercise(s) the demo seed needs: ` +
        `${missing.join("; ")}. No changes were made to the demo user.`
    );
    process.exit(1);
  }
  EX = resolved;
  console.log(`Resolved ${Object.keys(EX).length} exercise names to this database's IDs.`);
}

// A 3-day split. Each day: warmup → main (weighted) → conditioning → cooldown.
type ExSpec = {
  exerciseId: number;
  sets: number;
  reps: number;
  weight?: number; // planned weight (int); omit for bodyweight
  duration?: number; // seconds (for stretches/holds)
  restTime?: number;
};
type BlockSpec = {
  blockType: string;
  blockName: string;
  durationMinutes: number;
  rounds: number;
  order: number;
  exercises: ExSpec[];
};

function dayTemplate(dayKind: "mon" | "wed" | "fri"): {
  name: string;
  description: string;
  blocks: BlockSpec[];
} {
  const warmup: BlockSpec = {
    blockType: "warmup",
    blockName: "Warm-Up",
    durationMinutes: 6,
    rounds: 1,
    order: 1,
    exercises: [
      { exerciseId: EX.armCircles, sets: 1, reps: 15, duration: 45 },
      { exerciseId: EX.legSwings, sets: 1, reps: 12, duration: 45 },
      { exerciseId: EX.bandPullApart, sets: 2, reps: 15 },
    ],
  };
  const cooldown: BlockSpec = {
    blockType: "cooldown",
    blockName: "Cool-Down",
    durationMinutes: 5,
    rounds: 1,
    order: 4,
    exercises: [
      { exerciseId: EX.hamstringStretch, sets: 1, reps: 1, duration: 40 },
      { exerciseId: EX.chestStretch, sets: 1, reps: 1, duration: 40 },
      { exerciseId: EX.childsPose, sets: 1, reps: 1, duration: 45 },
    ],
  };

  if (dayKind === "mon") {
    return {
      name: "Upper Body Strength",
      description: "Shoulder-safe pressing and rows with a short finisher.",
      blocks: [
        warmup,
        {
          blockType: "traditional",
          blockName: "Main Strength",
          durationMinutes: 24,
          rounds: 1,
          order: 2,
          exercises: [
            { exerciseId: EX.inclinePress, sets: 3, reps: 10, weight: 25, restTime: 90 },
            { exerciseId: EX.dumbbellRow, sets: 3, reps: 10, weight: 30, restTime: 90 },
            { exerciseId: EX.tricepDips, sets: 3, reps: 12, restTime: 60 },
          ],
        },
        {
          blockType: "circuit",
          blockName: "Conditioning Circuit",
          durationMinutes: 10,
          rounds: 3,
          order: 3,
          exercises: [
            { exerciseId: EX.kettlebellSwing, sets: 1, reps: 15, weight: 35, restTime: 30 },
            { exerciseId: EX.burpee, sets: 1, reps: 10, restTime: 45 },
          ],
        },
        cooldown,
      ],
    };
  }
  if (dayKind === "wed") {
    return {
      name: "Lower Body & Core",
      description: "Squat-focused strength with a metabolic finisher.",
      blocks: [
        warmup,
        {
          blockType: "traditional",
          blockName: "Main Strength",
          durationMinutes: 26,
          rounds: 1,
          order: 2,
          exercises: [
            { exerciseId: EX.gobletSquat, sets: 4, reps: 10, weight: 40, restTime: 90 },
            { exerciseId: EX.dumbbellRow, sets: 3, reps: 10, weight: 30, restTime: 90 },
            { exerciseId: EX.airSquat, sets: 2, reps: 20, restTime: 45 },
          ],
        },
        {
          blockType: "circuit",
          blockName: "Conditioning Circuit",
          durationMinutes: 10,
          rounds: 3,
          order: 3,
          exercises: [
            { exerciseId: EX.boxJump, sets: 1, reps: 12, restTime: 30 },
            { exerciseId: EX.kettlebellSwing, sets: 1, reps: 15, weight: 35, restTime: 45 },
          ],
        },
        cooldown,
      ],
    };
  }
  // fri — full body
  return {
    name: "Full-Body Strength",
    description: "Compound pressing, rows and squats to round out the week.",
    blocks: [
      warmup,
      {
        blockType: "traditional",
        blockName: "Main Strength",
        durationMinutes: 26,
        rounds: 1,
        order: 2,
        exercises: [
          { exerciseId: EX.benchPress, sets: 4, reps: 8, weight: 95, restTime: 120 },
          { exerciseId: EX.dumbbellRow, sets: 3, reps: 10, weight: 30, restTime: 90 },
          { exerciseId: EX.gobletSquat, sets: 3, reps: 12, weight: 40, restTime: 90 },
        ],
      },
      {
        blockType: "circuit",
        blockName: "Conditioning Circuit",
        durationMinutes: 9,
        rounds: 3,
        order: 3,
        exercises: [
          { exerciseId: EX.kettlebellSwing, sets: 1, reps: 20, weight: 35, restTime: 30 },
          { exerciseId: EX.pushUp, sets: 1, reps: 15, restTime: 45 },
        ],
      },
      cooldown,
    ],
  };
}

// Classify a logged set's actual weight vs planned, cycling to produce a
// believable ~60/25/15 As-Planned / Progressed / Under-Target split.
function actualWeightFor(planned: number, globalSetIdx: number): number {
  const m = globalSetIdx % 8;
  if (m === 3 || m === 6) return planned + 5; // progressed
  if (m === 7) return Math.max(0, planned - 5); // under target
  return planned; // as planned
}

// ---------------------------------------------------------------------------
// Delete existing demo user (and all dependent rows), if present
// ---------------------------------------------------------------------------
async function deleteDemoUser(): Promise<void> {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, DEMO_EMAIL),
  });
  if (!existing) {
    console.log("No existing demo user — nothing to delete.");
    return;
  }
  const userId = existing.id;
  console.log(`Deleting existing demo user id=${userId} and all data…`);

  const userWorkouts = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(eq(workouts.userId, userId));
  const workoutIds = userWorkouts.map((w) => w.id);

  if (workoutIds.length) {
    const days = await db
      .select({ id: planDays.id })
      .from(planDays)
      .where(inArray(planDays.workoutId, workoutIds));
    const dayIds = days.map((d) => d.id);

    const blocks = dayIds.length
      ? await db
          .select({ id: workoutBlocks.id })
          .from(workoutBlocks)
          .where(inArray(workoutBlocks.planDayId, dayIds))
      : [];
    const blockIds = blocks.map((b) => b.id);

    const pdes = blockIds.length
      ? await db
          .select({ id: planDayExercises.id })
          .from(planDayExercises)
          .where(inArray(planDayExercises.workoutBlockId, blockIds))
      : [];
    const pdeIds = pdes.map((p) => p.id);

    const elogs = pdeIds.length
      ? await db
          .select({ id: exerciseLogs.id })
          .from(exerciseLogs)
          .where(inArray(exerciseLogs.planDayExerciseId, pdeIds))
      : [];
    const elogIds = elogs.map((e) => e.id);

    if (elogIds.length)
      await db
        .delete(exerciseSetLogs)
        .where(inArray(exerciseSetLogs.exerciseLogId, elogIds));
    if (pdeIds.length)
      await db
        .delete(exerciseLogs)
        .where(inArray(exerciseLogs.planDayExerciseId, pdeIds));
    if (dayIds.length)
      await db.delete(planDayLogs).where(inArray(planDayLogs.planDayId, dayIds));
    await db.delete(workoutLogs).where(inArray(workoutLogs.workoutId, workoutIds));
    if (blockIds.length)
      await db
        .delete(planDayExercises)
        .where(inArray(planDayExercises.workoutBlockId, blockIds));
    if (dayIds.length)
      await db
        .delete(workoutBlocks)
        .where(inArray(workoutBlocks.planDayId, dayIds));
    await db.delete(planDays).where(inArray(planDays.workoutId, workoutIds));
    // background_jobs references workouts (and the user) — clear before workouts.
    await db.delete(backgroundJobs).where(eq(backgroundJobs.userId, userId));
    await db.delete(workouts).where(eq(workouts.userId, userId));
  }

  await db.delete(trialUsage).where(eq(trialUsage.userId, userId));
  await db.delete(userSubscriptions).where(eq(userSubscriptions.userId, userId));
  await db.delete(profiles).where(eq(profiles.userId, userId));
  await db.delete(prompts).where(eq(prompts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  console.log("  ✓ demo user removed");
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed(): Promise<void> {
  // 1. User
  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      emailVerified: true,
      needsOnboarding: false,
      waiverAcceptedAt: eveningOf("2026-05-20"),
      waiverVersion: CURRENT_WAIVER_VERSION,
      isActive: true,
      themeMode: "auto",
      colorTheme: "original",
    })
    .returning();
  console.log(`Created user id=${user.id} ${user.email}`);

  // 2. Profile (Dave: 52, intermediate, commercial gym, shoulder-aware)
  await db.insert(profiles).values({
    userId: user.id,
    age: 52,
    height: 180,
    weight: 84,
    gender: Gender.MALE,
    goals: [FitnessGoals.STRENGTH, FitnessGoals.GENERAL_FITNESS],
    limitations: ["shoulder_pain"],
    fitnessLevel: FitnessLevels.INTERMEDIATE,
    environment: WorkoutEnvironments.COMMERCIAL_GYM,
    equipment: getEquipmentForEnvironment(
      WorkoutEnvironments.COMMERCIAL_GYM
    ) as any,
    preferredStyles: [
      PreferredStyles.STRENGTH,
      PreferredStyles.FUNCTIONAL,
      PreferredStyles.HIIT,
    ],
    availableDays: [
      PreferredDays.MONDAY,
      PreferredDays.WEDNESDAY,
      PreferredDays.FRIDAY,
    ],
    workoutDuration: 45,
    intensityLevel: IntensityLevels.MODERATE,
    includeWarmup: true,
    includeCooldown: true,
    timezone: "America/Chicago",
  });

  // 3. Subscription + trial usage (ACTIVE so no paywall blocks the screens)
  await db.insert(userSubscriptions).values({
    userId: user.id,
    status: SubscriptionStatus.ACTIVE,
    subscriptionStartDate: eveningOf("2026-05-20"),
  });
  await db.insert(trialUsage).values({
    userId: user.id,
    weeklyGenerationsCount: 0,
    dailyRegenerationsCount: 0,
    tokensUsed: 0,
  });

  // 4. One prompt row (workouts.promptId is NOT NULL)
  const [prompt] = await db
    .insert(prompts)
    .values({
      userId: user.id,
      prompt: "Demo seed program for Dave Walker (marketing screenshots).",
      response: "{}",
      threadId: null,
    })
    .returning();

  // 5. Four weekly workouts. The last is the ACTIVE week, anchored so its
  // final session (offset 4) lands on TODAY — the in-progress workout — with
  // the three prior weeks fully completed before it.
  const NUM_WEEKS = 12;
  const activeWeekStart = addDays(TODAY, -4);
  // Oldest week first; the last entry is the active week, whose final session
  // lands on TODAY.
  const weekStarts = Array.from({ length: NUM_WEEKS }, (_, i) =>
    addDays(activeWeekStart, -7 * (NUM_WEEKS - 1 - i))
  );
  const dayKinds: ("mon" | "wed" | "fri")[] = ["mon", "wed", "fri"];

  let setCounter = 0; // global, drives the planned/progressed/under split

  for (let w = 0; w < weekStarts.length; w++) {
    const weekStart = weekStarts[w];
    const isActiveWeek = w === weekStarts.length - 1;
    const weekEnd = addDays(weekStart, 6);

    const tmplName = isActiveWeek
      ? "Advanced Full-Body Strength"
      : `Full-Body Strength — Week of ${weekStart}`;
    const tmplDesc =
      "3-day split balancing strength, conditioning, and mobility — shoulder-safe programming built for training after 40.";

    const [workout] = await db
      .insert(workouts)
      .values({
        userId: user.id,
        startDate: weekStart,
        endDate: weekEnd,
        promptId: prompt.id,
        isActive: isActiveWeek,
        name: tmplName,
        description: tmplDesc,
        completed: !isActiveWeek,
      })
      .returning();

    const completedDayIds: number[] = [];
    let workoutTotalVolume = 0;

    for (let d = 0; d < dayKinds.length; d++) {
      const kind = dayKinds[d];
      const offset = d === 0 ? 0 : d === 1 ? 2 : 4; // Mon, Wed, Fri
      const date = addDays(weekStart, offset);
      const isToday = date === TODAY;
      // Completed unless it's today's session (left as the "active" workout).
      const completed = !isToday;
      const tmpl = dayTemplate(kind);

      const [planDay] = await db
        .insert(planDays)
        .values({
          workoutId: workout.id,
          date,
          name: tmpl.name,
          description: tmpl.description,
          dayNumber: d + 1,
          isComplete: completed,
        })
        .returning();
      if (completed) completedDayIds.push(planDay.id);

      let dayVolume = 0;
      let dayExercisesCompleted = 0;
      let dayBlocksCompleted = 0;

      for (const block of tmpl.blocks) {
        const [wb] = await db
          .insert(workoutBlocks)
          .values({
            planDayId: planDay.id,
            blockType: block.blockType,
            blockName: block.blockName,
            blockDurationMinutes: block.durationMinutes,
            rounds: block.rounds,
            order: block.order,
          })
          .returning();

        let blockHadCompletion = false;

        for (let ei = 0; ei < block.exercises.length; ei++) {
          const spec = block.exercises[ei];
          const [pde] = await db
            .insert(planDayExercises)
            .values({
              workoutBlockId: wb.id,
              exerciseId: spec.exerciseId,
              sets: spec.sets,
              reps: spec.reps,
              weight: spec.weight ?? null,
              duration: spec.duration ?? null,
              restTime: spec.restTime ?? null,
              order: ei + 1,
              completed,
            })
            .returning();

          if (!completed) continue;

          // Log this exercise (round 1) on the plan day's date.
          const loggedAt = eveningOf(date);
          const [elog] = await db
            .insert(exerciseLogs)
            .values({
              planDayExerciseId: pde.id,
              roundNumber: 1,
              durationCompleted: spec.duration ?? null,
              timeTaken: (spec.duration ?? 45) * (spec.sets || 1),
              isComplete: true,
              isSkipped: false,
              difficulty: "moderate",
              rating: 8,
              createdAt: loggedAt,
              updatedAt: loggedAt,
            })
            .returning();
          dayExercisesCompleted++;
          blockHadCompletion = true;

          // Per-set logs.
          for (let s = 1; s <= (spec.sets || 1); s++) {
            let actual = 0;
            if (spec.weight && spec.weight > 0) {
              actual = actualWeightFor(spec.weight, setCounter);
              setCounter++;
            }
            const reps = spec.reps ?? 0;
            dayVolume += actual > 0 ? actual * reps : reps;
            await db.insert(exerciseSetLogs).values({
              exerciseLogId: elog.id,
              roundNumber: 1,
              setNumber: s,
              weight: actual > 0 ? actual.toFixed(2) : null,
              reps,
              restAfter: spec.restTime ?? null,
            });
          }
        }
        if (blockHadCompletion) dayBlocksCompleted++;
      }

      if (completed) {
        workoutTotalVolume += dayVolume;
        const loggedAt = eveningOf(date);
        await db.insert(planDayLogs).values({
          planDayId: planDay.id,
          totalTimeSeconds: 2400 + d * 180, // ~40-46 min
          blocksCompleted: dayBlocksCompleted,
          exercisesCompleted: dayExercisesCompleted,
          totalVolume: dayVolume,
          averageHeartRate: 128 + d * 3,
          maxHeartRate: 150 + d * 5,
          isComplete: true,
          isSkipped: false,
          difficulty: "moderate",
          rating: 8,
          mood: "energized",
          createdAt: loggedAt,
          updatedAt: loggedAt,
        });
      }
    }

    // Workout-level rollup log.
    await db.insert(workoutLogs).values({
      workoutId: workout.id,
      totalTimeMinutes: completedDayIds.length * 43,
      daysCompleted: completedDayIds.length,
      totalDays: dayKinds.length,
      totalVolume: workoutTotalVolume,
      averageRating: "8.00",
      completedDays: completedDayIds,
      isComplete: !isActiveWeek,
      isActive: isActiveWeek,
    });

    console.log(
      `  ✓ ${isActiveWeek ? "ACTIVE" : "past"} week ${weekStart}: ${completedDayIds.length}/${dayKinds.length} days completed`
    );
  }

  console.log(`\nDone. Demo user "${DEMO_NAME}" <${DEMO_EMAIL}> id=${user.id}`);
  console.log(`Total weighted sets logged: ${setCounter}`);
}

// ---------------------------------------------------------------------------
async function run() {
  assertLocalDatabase(process.argv.includes("--remote"));
  const deleteOnly = process.argv.includes("--delete");
  await deleteDemoUser();
  if (deleteOnly) {
    console.log("Delete-only mode; not reseeding.");
    process.exit(0);
  }
  await resolveExerciseIds();
  await seed();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

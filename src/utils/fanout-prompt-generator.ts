import { Profile } from "@/models";
import { AvailableEquipment, PreferredStyles } from "@/constants/profile";
import { CANONICAL_MUSCLE_GROUPS } from "@/constants/muscle-groups";
import {
  PlanDaySlot,
  formatSlotLabel,
  renderScheduleLines,
  effectiveAvailableDays,
} from "./plan-schedule";
import {
  getEquipmentDescription,
  getStyleInterpretationGuide,
  getConstraintIntegrationProtocol,
  getRecoveryEnhancementGuide,
  getBlockTypeGuide,
  getEquipmentUsageGuidelines,
  getDurationRequirements,
  getProfessionalProgrammingPriorities,
  getCriticalConstraints,
  getStyleMixingExamples,
} from "./prompt-generator";

/**
 * Prompts and schemas for fan-out weekly generation: one small planning call
 * that designs the week split, then one call per day running in parallel.
 *
 * Cache design: everything profile-stable lives in the system prompt (marked
 * with cache_control by the caller); volatile content (feedback, day
 * assignment, week plan) goes in the user message so the cached prefix is
 * byte-identical across the planning call, all day calls, and repeat
 * generations for the same user.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeekPlanDay {
  day: number;
  name: string;
  focus: string;
  primaryMuscleGroups: string[];
  styles: string[];
}

/**
 * [GQ-05] Normalized, explicit constraints the planning call extracts from the
 * user's custom feedback, restated as concrete rules. Injected verbatim into
 * every day call so each day enforces the same rules instead of re-deriving them
 * from the raw prose (which is how "no deadlifts" leaked through per-day before).
 */
export interface WeekConstraints {
  must: string[];
  avoid: string[];
  /**
   * [GQ-07] Literal, lowercased exercise-name fragments implied by the avoid
   * rules (e.g. ["deadlift", "barbell"]). Used for DETERMINISTIC post-generation
   * enforcement — any generated exercise whose name contains one of these is
   * swapped from the catalog or dropped, so AVOID compliance no longer depends
   * on the model honoring the prose.
   */
  avoidExerciseTerms?: string[];
  /**
   * [GQ-02] Explicit scheduling overrides the user asked for THIS week — which
   * weekdays, how many days, and which weekday to start on. Only present when
   * the user actually requested a change; resolved deterministically into the
   * generation schedule (see resolveEffectiveSchedule).
   */
  schedule?: {
    daysOfWeek?: string[];
    dayCount?: number;
    startWeekday?: string;
  };
  /**
   * [GQ-06] Weekday NAMES that must be BODYWEIGHT-ONLY — no equipment. Only
   * present when the user explicitly asked for an equipment-free day (e.g. a
   * travel day). The service maps each weekday to its schedule day number, so
   * the model only has to name the weekday (which it knows from the request) and
   * never does day-number arithmetic. Enforced deterministically: equipment-
   * requiring exercises on those days are swapped for bodyweight ones.
   */
  bodyweightOnlyWeekdays?: string[];
}

/**
 * [GQ-04] A specific thing the user asked for that the plan could NOT honor,
 * plus the reason — surfaced in-app ("Couldn't apply X because Y") so the user
 * understands why the generated week differs from their request instead of
 * assuming it was ignored. The planner emits these for semantic conflicts it
 * detects (contradictory/infeasible/unsafe asks); the service also appends
 * deterministic ones (e.g. a schedule that had to be clamped).
 */
export interface FeedbackConflict {
  /** The user's request, restated briefly, e.g. "6 workout days this week". */
  request: string;
  /** Why it couldn't be honored, e.g. "your profile has 3 available days". */
  reason: string;
}

export interface WeekPlan {
  name: string;
  description: string;
  constraints?: WeekConstraints;
  feedbackConflicts?: FeedbackConflict[];
  days: WeekPlanDay[];
}

/**
 * [GQ-08] Two separate feedback channels with explicit precedence. The live
 * request is what the user asked for THIS generation and wins; the recent digest
 * is background signal from past post-workout feedback. They used to be blended
 * into one opaque string, so a strong current request and a stale note carried
 * equal weight.
 */
export interface PromptFeedback {
  /** The user's current explicit request (highest priority). */
  customFeedback?: string;
  /** Digest of recent post-workout feedback (background signal, lower priority). */
  recentFeedback?: string;
}

// ---------------------------------------------------------------------------
// Structured-output schemas (plain JSON Schema — used as tool input schemas
// via withStructuredOutput, so output is guaranteed parseable)
// ---------------------------------------------------------------------------

// Canonical vocabularies — the schema enums must match what the rest of the
// system stores and filters on, or new exercises silently fall out of
// equipment-filtered searches.
const VALID_EQUIPMENT = Object.values(AvailableEquipment);

const VALID_TAGS = Object.values(PreferredStyles);

const BLOCK_TYPES = [
  "traditional",
  "superset",
  "amrap",
  "emom",
  "for_time",
  "circuit",
  "flow",
  "tabata",
  "warmup",
  "cooldown",
];

export const WEEK_PLAN_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "Short holistic name for the entire weekly plan (no day ranges, e.g. 'Advanced Strength + HIIT')",
    },
    description: {
      type: "string",
      description: "Very short plan description (10-15 words)",
    },
    constraints: {
      type: "object",
      description:
        "Normalized restatement of the user's EXPLICIT requests from their current custom feedback, turned into concrete rules the per-day generation must follow. Extract every specific instruction the user gave. Use empty arrays if there is no custom feedback — do NOT invent constraints the user did not state.",
      properties: {
        must: {
          type: "array",
          items: { type: "string" },
          description:
            "Things the plan MUST do/include, each a short concrete rule, e.g. 'Wednesday must be a bodyweight-only workout', 'include an AMRAP finisher every day'.",
        },
        avoid: {
          type: "array",
          items: { type: "string" },
          description:
            "Things the plan MUST NOT include, each a short concrete rule, e.g. 'no deadlift variations of any kind', 'no barbell exercises'.",
        },
        avoidExerciseTerms: {
          type: "array",
          items: { type: "string" },
          description:
            "The literal exercise-NAME fragments implied by the avoid rules, lowercased, that code will use to hard-filter the generated exercises. Give the specific matchable term(s) for each avoid rule: 'no deadlifts' -> ['deadlift']; 'no barbell work' -> ['barbell']; 'no burpees or box jumps' -> ['burpee', 'box jump']. Prefer the shortest fragment that still uniquely identifies the banned movement so all variations are caught (e.g. 'deadlift' catches 'Romanian Deadlift'). Empty array if no exclusion-type requests.",
        },
        schedule: {
          type: "object",
          description:
            "[GQ-02] ONLY populate a field here if the user EXPLICITLY asked to change WHEN/HOW MANY days they train this week. Omit fields (or the whole object) otherwise — never infer from the profile's normal schedule.",
          properties: {
            daysOfWeek: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "monday",
                  "tuesday",
                  "wednesday",
                  "thursday",
                  "friday",
                  "saturday",
                  "sunday",
                ],
              },
              description:
                "The specific weekdays to train THIS week if the user named them (e.g. 'just Mon/Wed/Fri' -> [monday, wednesday, friday]; 'weekends only' -> [saturday, sunday]). Omit if the user didn't specify particular days.",
            },
            dayCount: {
              type: "number",
              description:
                "The number of workout days if the user asked for a specific count (e.g. 'only 3 days this week' -> 3). If set, return exactly this many day entries in `days`. Omit if not specified.",
            },
            startWeekday: {
              type: "string",
              enum: [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
              ],
              description:
                "The weekday the user wants the plan to START on if they asked (e.g. 'start me on Monday' -> monday). Omit if not specified.",
            },
          },
        },
        bodyweightOnlyWeekdays: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ],
          },
          description:
            "[GQ-06] WEEKDAY NAMES that must be BODYWEIGHT-ONLY — no equipment at all. ONLY populate when the user explicitly asked for an equipment-free day, e.g. 'I travel Wednesdays, make that a bodyweight workout' -> ['wednesday']. Just name the weekday; the system maps it to the right day. Empty array otherwise — never infer.",
        },
      },
      required: ["must", "avoid", "avoidExerciseTerms"],
    },
    feedbackConflicts: {
      type: "array",
      description:
        "[GQ-04] Parts of the user's CURRENT custom feedback you could NOT fully honor, and why — surfaced to the user in-app. ONLY include a genuine conflict: a request that is self-contradictory ('avoid all leg work but focus on squats'), infeasible given their profile/equipment, or unsafe given their limitations. Do NOT list things you DID honor, and do NOT invent conflicts — an empty array is the normal case. Do NOT report scheduling or day-count conflicts (how many days, or which weekdays) — those are detected separately, so listing them here would duplicate. Phrase each for the user: `request` = what they asked (short), `reason` = why it couldn't be applied (short, plain language).",
      items: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description:
              "The user's request, restated briefly, e.g. 'a squat-focused leg day with no leg exercises'.",
          },
          reason: {
            type: "string",
            description:
              "Why it couldn't be honored, plain language, e.g. 'those requests contradict each other, so the day focuses on squats and related lower-body work'.",
          },
        },
        required: ["request", "reason"],
      },
    },
    days: {
      type: "array",
      description:
        "One entry per workout day, numbered sequentially from 1. Balance muscle groups and intensity across the week — never program the same heavy muscle groups on consecutive days.",
      items: {
        type: "object",
        properties: {
          day: { type: "number", description: "Sequential day number from 1" },
          name: {
            type: "string",
            description:
              "Name of this workout day, e.g. 'Upper Body Strength + AMRAP'",
          },
          focus: {
            type: "string",
            description:
              "One-sentence training focus for this day (what it trains and how)",
          },
          primaryMuscleGroups: {
            type: "array",
            items: { type: "string", enum: CANONICAL_MUSCLE_GROUPS },
            description:
              "Primary muscle groups trained on this day, chosen ONLY from the canonical list. Use the specific groups (e.g. quads, hamstrings, glutes) rather than umbrellas so cross-day balance can be checked.",
          },
          styles: {
            type: "array",
            items: { type: "string" },
            description:
              "Which of the user's preferred styles this day draws from",
          },
        },
        required: ["day", "name", "focus", "primaryMuscleGroups", "styles"],
      },
    },
  },
  required: ["name", "description", "constraints", "days"],
} as const;

const EXERCISE_SCHEMA = {
  type: "object",
  properties: {
    exerciseName: {
      type: "string",
      description:
        "EXACT name from the AVAILABLE EXERCISES list, or a new exercise that is also included in exercisesToAdd",
    },
    sets: {
      type: "number",
      description:
        "Actual sets for traditional blocks; 1 for AMRAP/circuits/flows",
    },
    reps: {
      type: "number",
      description: "Target reps per set/round; 0 for time-based exercises",
    },
    weight: {
      type: "number",
      description: "Weight in lbs; 0 for bodyweight/unweighted exercises",
    },
    duration: {
      type: "number",
      description: "Seconds per set/hold; 0 for rep-based exercises",
    },
    restTime: {
      type: "number",
      description:
        "Seconds rest between sets; for circuits/AMRAP, rest between exercises within a round",
    },
    repsMin: {
      type: "number",
      description:
        "Optional lower bound of a rep range (e.g. 8 in '8-12 reps'); omit when reps is a fixed target",
    },
    repsMax: {
      type: "number",
      description:
        "Optional upper bound of a rep range (e.g. 12 in '8-12 reps'); omit when reps is a fixed target",
    },
    rpe: {
      type: "number",
      description:
        "Optional target effort, RPE 1-10 (e.g. 7 = could do ~3 more reps); prefer this over putting RPE in notes",
    },
    distanceM: {
      type: "number",
      description:
        "Optional prescribed distance in METERS for runs/rows/carries (1 mile = 1609); use with reps=0. Prefer this over describing distance in notes",
    },
    notes: {
      type: "string",
      description:
        "One concise coaching cue (max ~12 words) for THIS exercise specifically — how to execute THIS movement (tempo, form, effort). Never describe, name, or cue a different exercise.",
    },
    order: {
      type: "number",
      description: "Order within the block, starting from 1",
    },
  },
  required: [
    "exerciseName",
    "sets",
    "reps",
    "weight",
    "duration",
    "restTime",
    "notes",
    "order",
  ],
} as const;

const BLOCK_SCHEMA = {
  type: "object",
  properties: {
    blockType: { type: "string", enum: BLOCK_TYPES },
    blockName: {
      type: "string",
      description: "Name of this block, e.g. 'AMRAP WOD', 'Strength Circuit'",
    },
    primaryMuscleGroups: {
      type: "array",
      items: { type: "string", enum: CANONICAL_MUSCLE_GROUPS },
      description:
        "[GQ-12] The muscle groups THIS BLOCK targets, from the canonical list — the block's own focus, which can differ from other blocks on the same day. This is what unlocks mixed days: e.g. a focused strength block on ['chest'] followed by a conditioning block on ['full_body']. For a metcon/conditioning block that hits the whole body, use ['full_body']. Choose specific groups (quads, hamstrings) over umbrellas so the day's balance can be checked per block.",
    },
    blockDurationMinutes: {
      type: "number",
      description: "Calculated total duration of this block in minutes",
    },
    timeCapMinutes: {
      type: "number",
      description:
        "Time cap for time-based formats (AMRAP, EMOM); 0 when not applicable",
    },
    rounds: {
      type: "number",
      description: "Rounds for circuit/flow types; 1 for traditional sets",
    },
    protocolConfig: {
      type: "object",
      description:
        "Optional structured protocol details. Use INSTEAD of describing these in prose.",
      properties: {
        repScheme: {
          type: "array",
          items: { type: "number" },
          description:
            "Per-round rep targets for descending/ascending schemes, e.g. [21, 15, 9]. When set, rounds MUST equal its length and each exercise's reps should be 0.",
        },
        workSeconds: {
          type: "number",
          description:
            "Work interval in seconds for interval formats (tabata = 20, '30s on/15s off' = 30)",
        },
        restSeconds: {
          type: "number",
          description:
            "Rest interval in seconds for interval formats (tabata = 10, '30s on/15s off' = 15)",
        },
        intervalSeconds: {
          type: "number",
          description:
            "Slot length for EMOM-family blocks: 60 = EMOM, 90 = every 90s, 120 = E2MOM",
        },
      },
    },
    instructions: {
      type: "string",
      description:
        "Block coaching instructions: format, pacing, execution. Max 3 sentences. Describe the block generically — do NOT name specific exercises or restate rep/weight numbers (they're listed per exercise and may be adjusted downstream, which would leave this text stale).",
    },
    order: {
      type: "number",
      description: "Order of this block within the day, starting from 1",
    },
    exercises: { type: "array", items: EXERCISE_SCHEMA },
  },
  required: [
    "blockType",
    "blockName",
    "primaryMuscleGroups",
    "blockDurationMinutes",
    "timeCapMinutes",
    "rounds",
    "instructions",
    "order",
    "exercises",
  ],
} as const;

const EXERCISE_TO_ADD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    equipment: {
      type: "array",
      items: { type: "string", enum: VALID_EQUIPMENT },
    },
    muscleGroups: { type: "array", items: { type: "string" } },
    difficulty: { type: "string", enum: ["low", "moderate", "high"] },
    instructions: {
      type: "string",
      description: "How to perform this exercise (not workout instructions)",
    },
    link: {
      type: "string",
      description:
        "YouTube link showing how to perform the exercise; public image link for form-free activities like walking",
    },
    tag: { type: "string", enum: VALID_TAGS },
  },
  required: [
    "name",
    "description",
    "equipment",
    "muscleGroups",
    "difficulty",
    "instructions",
    "link",
    "tag",
  ],
} as const;

export const WORKOUT_DAY_SCHEMA = {
  type: "object",
  properties: {
    day: { type: "number", description: "The assigned day number" },
    name: { type: "string", description: "Name of this workout day" },
    description: {
      type: "string",
      description:
        "Brief description of this day's training intent (e.g. 'Lower-body strength with a short conditioning finisher'). Do NOT enumerate specific exercises, weights, or reps.",
    },
    instructions: {
      type: "string",
      description:
        "Day-level coaching: block order, pacing, intensity, safety. Max 4 sentences. Describe STRATEGY, not a rundown — do NOT list specific exercise names, weights, or rep counts (those appear per exercise below and may be adjusted downstream, which leaves any restatement here stale). Refer to blocks by role, e.g. 'the strength block', 'the conditioning finisher'.",
    },
    blocks: { type: "array", items: BLOCK_SCHEMA },
    exercisesToAdd: {
      type: "array",
      description:
        "New exercises used in this day that are NOT in the AVAILABLE EXERCISES list. Empty array if none.",
      items: EXERCISE_TO_ADD_SCHEMA,
    },
    limitationConcerns: {
      type: "array",
      description:
        "[LR-013] If the user has physical limitations/medical notes, list any exercise in this day that's borderline for one of them even though you included it (e.g. a rule-based filter wouldn't necessarily catch this). Empty array if nothing borderline. This does NOT get removed automatically — it's logged for a human to review.",
      items: { type: "string" },
    },
  },
  required: [
    "day",
    "name",
    "description",
    "instructions",
    "blocks",
    "exercisesToAdd",
    "limitationConcerns",
  ],
} as const;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const buildProfileContext = (profile: Profile): string => {
  return `## USER PROFILE

**Demographics:**
- Age: ${profile.age}
- Gender: ${profile.gender}
- Height: ${profile.height} cm
- Weight: ${profile.weight} lbs

**Fitness Profile:**
- Goals: ${profile.goals}
- Physical Limitations: ${profile.limitations}
- Fitness Level: ${profile.fitnessLevel}
- Intensity Level: ${profile.intensityLevel}
- Medical Notes: ${profile.medicalNotes || "None"}

**Training Preferences:**
- Preferred Styles: ${profile.preferredStyles?.join(", ") || "General fitness"}
- Available Days: ${effectiveAvailableDays(profile.availableDays).join(", ")}
- Workout Duration: ${profile.workoutDuration} minutes per session
- Environment: ${profile.environment}
- Available Equipment: ${getEquipmentDescription(
    profile.environment,
    profile.equipment,
    profile.otherEquipment
  )}`;
};

/**
 * Profile-stable system prompt shared by the planning call and every day
 * call. The caller appends the exercise context and marks the whole message
 * with cache_control — keep anything volatile (feedback, day assignment)
 * OUT of this function or the cache never hits.
 */
export const buildFanoutSystemPrompt = (profile: Profile): string => {
  const workoutDuration = profile.workoutDuration || 30;
  const includeWarmup = profile.includeWarmup ?? true;
  const includeCooldown = profile.includeCooldown ?? true;

  return `# PROFESSIONAL FITNESS PROGRAMMING ASSISTANT

You are an experienced fitness trainer and certified fitness professional. You design complete, professional-quality workout programs that are authentic to the user's preferred training styles while respecting their limitations and constraints.

You operate in one of two modes per request (the user message states which):
1. **WEEK PLANNING**: design the high-level weekly split — day names, focus, muscle groups, styles. No exercises yet.
2. **DAY GENERATION**: build one complete workout day according to its assignment in an already-designed weekly plan.

${includeWarmup ? "" : "**USER HAS DISABLED WARMUPS**: Do NOT include any warmup blocks. Begin workouts directly with main exercise blocks.\n"}${includeCooldown ? "" : "**USER HAS DISABLED COOLDOWNS**: Do NOT include any cooldown blocks.\n"}
${getConstraintIntegrationProtocol()}

${getStyleInterpretationGuide()}

${getRecoveryEnhancementGuide()}

${getDurationRequirements(workoutDuration, "daily", includeWarmup, includeCooldown)}

${getEquipmentUsageGuidelines()}

${getProfessionalProgrammingPriorities("daily")}

${getBlockTypeGuide()}

${getCriticalConstraints("daily")}

${getStyleMixingExamples()}

## EXERCISE SELECTION PROCESS (DAY GENERATION)

1. **Design first**: build the best workout for the day's assignment based on the user's profile, goals, limitations, and equipment — do not browse the exercise list first.
2. **Check the database**: the AVAILABLE EXERCISES list below is your reference database. For each exercise you designed, use the EXACT database name if it exists there.
3. **New exercises**: any exercise not in the database MUST be added to 'exercisesToAdd' with complete details (equipment restricted to the user's environment; link must be a YouTube demo, or a public image for form-free activities like walking).
4. **Validity**: every exercise must be a real, performable movement ("Pushups" is valid; "Warmup" or "Stretching" is not).
5. **Variety & intra-session balance**: do NOT use the same exercise more than twice in a single day. Spread the work across the day's assigned primary muscle groups rather than hammering one — no single muscle group should dominate the session unless the day's focus is explicitly that one area. Prefer distinct movements over padding the workout with repeats of the same exercise.
6. **Limitations self-check**: if the user has physical limitations or medical notes, after building the day review it against them and populate 'limitationConcerns' with the name of any exercise that's borderline for one of those limitations, even if you decided to keep it. Empty array if nothing borderline — this is a review flag, not a request to remove anything yourself.

## CONCISENESS REQUIREMENTS

Quality of programming over volume of prose:
- Day-level instructions: max 4 sentences (flow, intensity, safety)
- Block instructions: max 3 sentences (format, pacing)
- Exercise notes: one cue, max ~12 words
Never sacrifice exercise count, block count, or duration compliance for brevity — trim words, not programming.`;
};

/**
 * [GQ-08] Renders the two feedback channels as separate, precedence-labeled
 * sections so the model treats the current request as authoritative and the
 * recent digest as background.
 */
const renderFeedbackSections = (feedback?: PromptFeedback): string => {
  const current = feedback?.customFeedback?.trim();
  const recent = feedback?.recentFeedback?.trim();
  return `**Your current request (HIGHEST priority — honor this specifically):** ${
    current || "None"
  }

**Recent post-workout feedback (background signal only — the current request above wins if they conflict):** ${
    recent || "None"
  }`;
};

/**
 * [GQ-05] Renders the normalized MUST/AVOID constraints for a day call. Empty
 * string when there are no constraints (no custom feedback), so unconstrained
 * generations look exactly as before.
 */
const renderConstraintsSection = (constraints?: WeekConstraints): string => {
  const must = constraints?.must?.filter((c) => c.trim()) || [];
  const avoid = constraints?.avoid?.filter((c) => c.trim()) || [];
  if (must.length === 0 && avoid.length === 0) return "";

  const mustLines = must.length ? must.map((m) => `- ${m}`).join("\n") : "- (none)";
  const avoidLines = avoid.length ? avoid.map((a) => `- ${a}`).join("\n") : "- (none)";
  return `## USER CONSTRAINTS (extracted from the user's request — apply to THIS day exactly)

**MUST:**
${mustLines}

**AVOID — never include any exercise matching these, no variations, no substitutions that reintroduce them:**
${avoidLines}

`;
};

export const buildPlanningUserMessage = (
  profile: Profile,
  schedule: PlanDaySlot[],
  feedback?: PromptFeedback
): string => {
  // [GQ-17] Use the resolved schedule length (already reflects the safe fallback
  // and any GQ-02 override) — never an independent availableDays count, which
  // could disagree with the dates the schedule actually renders.
  const dayCount = schedule.length;

  return `${buildProfileContext(profile)}

${renderFeedbackSections(feedback)}

## THIS WEEK'S TRAINING DATES

Each numbered day lands on a specific real weekday/date — design the split with those in mind (e.g. keep the day before a stated event lighter, honor "make Fridays easy"):
${renderScheduleLines(schedule)}

## TASK: WEEK PLANNING

Design the weekly split for this user. By default, return exactly ${dayCount} days, numbered sequentially 1 to ${dayCount}, matching the dates listed above. **Exception:** if the user's current request specifies a different number of workout days or particular training days (e.g. "only 3 days this week", "just Mondays and Wednesdays", "weekends only"), return THAT many day entries instead and record it under \`constraints.schedule\` — the real dates are re-derived from your schedule fields, so just return the right COUNT of days.

This is the WEEK PLANNING mode described in your instructions: produce only the high-level split (names, focus, muscle groups, styles). The day-generation requirements (duration compliance, block structure, exercise selection) apply to the per-day calls that follow, not to this plan.

Requirements:
- Balance muscle groups and intensity across the week — no heavy same-muscle-group work on consecutive training days
- Honor the user's preferred styles: each day draws from them authentically, either combined within a day or distributed across the week
- Respect limitations and medical notes when assigning focus
- The plan name must be holistic (never include day ranges like "Days 1-2")
- Honor the user's current request: apply every explicit instruction in it unless doing so would be genuinely unsafe given the user's limitations or physically impossible with their equipment. If a request can't be applied safely, adapt it as closely as possible — do NOT silently drop a request just because it is unconventional or harder to program.

## CAPTURE THE USER'S REQUESTS

Populate the \`constraints\` field by extracting EVERY explicit instruction from the current request above into concrete \`must\` / \`avoid\` rules (e.g. "no deadlifts" → avoid: "no deadlift variations of any kind"; "bodyweight only on Wednesday" → must: "Wednesday's workout must use no equipment"). For any exclusion of a movement/equipment, ALSO list the literal lowercased name fragment(s) in \`avoidExerciseTerms\` so code can hard-enforce it (e.g. "no deadlifts" → avoidExerciseTerms: ["deadlift"]; "no burpees or box jumps" → ["burpee", "box jump"]). These rules are passed verbatim to each day's generation, so be specific and complete. If there is no current request, use empty arrays — never invent constraints the user didn't state.

If (and ONLY if) the user explicitly asked to change WHEN or HOW MANY days they train this week, also fill \`constraints.schedule\` (\`daysOfWeek\`, \`dayCount\`, and/or \`startWeekday\`) — e.g. "just Mon/Wed/Fri" → daysOfWeek: [monday, wednesday, friday]; "only 3 days" → dayCount: 3; "start me on Monday" → startWeekday: monday. Leave it empty for a normal week.`;
};

export const buildDayUserMessage = (
  profile: Profile,
  weekPlan: WeekPlan,
  day: WeekPlanDay,
  schedule: PlanDaySlot[],
  feedback?: PromptFeedback
): string => {
  const slotByDay = new Map(schedule.map((s) => [s.dayNumber, s]));
  const weekContext = weekPlan.days
    .map((d) => {
      const slot = slotByDay.get(d.day);
      const dateLabel = slot ? `${formatSlotLabel(slot)}: ` : "";
      return `- Day ${d.day} — ${dateLabel}${d.name} — ${d.focus} [${d.primaryMuscleGroups.join(
        ", "
      )}]${d.day === day.day ? "  ← YOU ARE GENERATING THIS DAY" : ""}`;
    })
    .join("\n");
  const thisSlot = slotByDay.get(day.day);
  const thisDateLabel = thisSlot ? ` — ${formatSlotLabel(thisSlot)}` : "";

  return `${buildProfileContext(profile)}

${renderFeedbackSections(feedback)}

${renderConstraintsSection(weekPlan.constraints)}## TASK: DAY GENERATION

Weekly plan "${weekPlan.name}" (${weekPlan.description}):
${weekContext}

Generate the COMPLETE workout for **Day ${day.day}${thisDateLabel}: ${day.name}**.
- Focus: ${day.focus}
- Primary muscle groups: ${day.primaryMuscleGroups.join(", ")}
- Styles: ${day.styles.join(", ")}

Requirements:
- Honor the USER CONSTRAINTS above: include everything under MUST and never include anything under AVOID. This OVERRIDES style/variety/focus defaults — if honoring a constraint removes an obvious exercise (even one that fits the day perfectly), pick a compliant alternative instead.
- Total duration MUST be ${profile.workoutDuration || 30} minutes (±5). Sum of blockDurationMinutes must hit this target — add blocks/exercises as needed.
- Stay authentic to the assigned styles and focus; this day must complement (not repeat) the rest of the week shown above
- [GQ-12] Give EACH block its own \`primaryMuscleGroups\` — the muscles that block trains. Blocks on the same day may target different muscles: this is how you build mixed days like a focused strength block (e.g. ['chest']) followed by a conditioning block (e.g. ['full_body']). Match the block's exercises to its stated focus; use ['full_body'] for whole-body metcon/conditioning blocks.
- Use a variety of exercises: do NOT repeat the same exercise more than twice in this workout, and distribute the work across this day's primary muscle groups
- Use EXACT exercise names from the AVAILABLE EXERCISES list; put any new exercises in exercisesToAdd
- Set day = ${day.day} in your response
- FINAL CHECK before you return: re-read every exerciseName you chose and compare it against the AVOID list. Match on the KEYWORDS in each AVOID rule — if an AVOID keyword appears anywhere in an exercise's name, that exercise is banned, with NO exception for "lighter", single-leg, bodyweight, or otherwise "not really" versions. Example: an AVOID of "deadlifts" bans "Barbell Deadlift", "Romanian Deadlift", AND "Single-Leg Deadlift Reach"; an AVOID of "barbell" bans every exercise whose name includes "Barbell". Delete any match and replace it with a compliant alternative. A single AVOID violation makes the entire workout unacceptable.`;
};

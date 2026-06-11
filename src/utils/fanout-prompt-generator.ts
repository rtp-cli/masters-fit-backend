import { Profile } from "@/models";
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

export interface WeekPlan {
  name: string;
  description: string;
  days: WeekPlanDay[];
}

// ---------------------------------------------------------------------------
// Structured-output schemas (plain JSON Schema — used as tool input schemas
// via withStructuredOutput, so output is guaranteed parseable)
// ---------------------------------------------------------------------------

const VALID_EQUIPMENT = [
  "dumbbells",
  "resistance_bands",
  "machines",
  "bodyweight",
  "kettlebells",
  "medicine_ball",
  "foam_roller",
  "treadmill",
  "bike",
  "yoga_mat",
];

const VALID_TAGS = [
  "hiit",
  "strength",
  "cardio",
  "rehab",
  "crossfit",
  "functional",
  "pilates",
  "yoga",
  "balance",
  "mobility",
];

const BLOCK_TYPES = [
  "traditional",
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
            items: { type: "string" },
            description: "Primary muscle groups trained on this day",
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
  required: ["name", "description", "days"],
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
    notes: {
      type: "string",
      description: "One concise coaching cue, max ~12 words",
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
    instructions: {
      type: "string",
      description:
        "Block coaching instructions: format, pacing, execution. Max 3 sentences.",
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
      description: "Brief description of this day's focus",
    },
    instructions: {
      type: "string",
      description:
        "Day-level coaching: overall flow, pacing, intensity, safety. Max 4 sentences.",
    },
    blocks: { type: "array", items: BLOCK_SCHEMA },
    exercisesToAdd: {
      type: "array",
      description:
        "New exercises used in this day that are NOT in the AVAILABLE EXERCISES list. Empty array if none.",
      items: EXERCISE_TO_ADD_SCHEMA,
    },
  },
  required: [
    "day",
    "name",
    "description",
    "instructions",
    "blocks",
    "exercisesToAdd",
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
- Available Days: ${profile.availableDays?.join(", ") || "All days"}
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

## CONCISENESS REQUIREMENTS

Quality of programming over volume of prose:
- Day-level instructions: max 4 sentences (flow, intensity, safety)
- Block instructions: max 3 sentences (format, pacing)
- Exercise notes: one cue, max ~12 words
Never sacrifice exercise count, block count, or duration compliance for brevity — trim words, not programming.`;
};

export const buildPlanningUserMessage = (
  profile: Profile,
  customFeedback?: string
): string => {
  const dayCount = profile.availableDays?.length || 7;

  return `${buildProfileContext(profile)}

**Custom Feedback:** ${customFeedback || "None"}

## TASK: WEEK PLANNING

Design the weekly split for this user. Return exactly ${dayCount} days, numbered sequentially 1 to ${dayCount} (they map to: ${
    profile.availableDays?.join(", ") || "all days"
  }).

Requirements:
- Balance muscle groups and intensity across the week — no heavy same-muscle-group work on consecutive training days
- Honor the user's preferred styles: each day draws from them authentically, either combined within a day or distributed across the week
- Respect limitations and medical notes when assigning focus
- The plan name must be holistic (never include day ranges like "Days 1-2")
- Only incorporate custom feedback if it aligns with the user's profile, goals, limitations, and equipment; ignore unsafe or quality-reducing requests`;
};

export const buildDayUserMessage = (
  profile: Profile,
  weekPlan: WeekPlan,
  day: WeekPlanDay,
  customFeedback?: string
): string => {
  const weekContext = weekPlan.days
    .map(
      (d) =>
        `- Day ${d.day}: ${d.name} — ${d.focus} [${d.primaryMuscleGroups.join(
          ", "
        )}]${d.day === day.day ? "  ← YOU ARE GENERATING THIS DAY" : ""}`
    )
    .join("\n");

  return `${buildProfileContext(profile)}

**Custom Feedback:** ${customFeedback || "None"}

## TASK: DAY GENERATION

Weekly plan "${weekPlan.name}" (${weekPlan.description}):
${weekContext}

Generate the COMPLETE workout for **Day ${day.day}: ${day.name}**.
- Focus: ${day.focus}
- Primary muscle groups: ${day.primaryMuscleGroups.join(", ")}
- Styles: ${day.styles.join(", ")}

Requirements:
- Total duration MUST be ${profile.workoutDuration || 30} minutes (±5). Sum of blockDurationMinutes must hit this target — add blocks/exercises as needed.
- Stay authentic to the assigned styles and focus; this day must complement (not repeat) the rest of the week shown above
- Use EXACT exercise names from the AVAILABLE EXERCISES list; put any new exercises in exercisesToAdd
- Set day = ${day.day} in your response`;
};

import { Profile } from "@/models";
import {
  AvailableEquipment,
  FitnessGoals,
  FitnessLevels,
  IntensityLevels,
  PhysicalLimitations,
  PreferredDays,
  PreferredStyles,
  WorkoutEnvironments,
  Gender,
} from "@/constants/profile";
import { AIProvider, DEFAULT_AI_MODEL } from "@/constants/ai-providers";
import type { ComplianceCheck } from "@/utils/generation-compliance";
import type { PlanDaySlot } from "@/utils/plan-schedule";

/**
 * [GQ-13] Representative override scenarios for the generation eval harness.
 *
 * Drawn from anticipated GENERAL usage (calendar asks, exclusions, equipment
 * rules, format asks, plain regression controls) — deliberately NOT just the
 * user-41 forensic case, so the harness measures whether prompt changes help
 * everyone rather than overfitting one report. Each scenario declares the
 * compliance checks it should satisfy; `buildChecks` receives the resolved
 * day-number->date schedule so calendar/day-scoped checks can name the right day.
 */

const DURATION_TOLERANCE = 5;

/** Base fixture profile; scenarios override the fields they care about. */
function baseProfile(overrides: Partial<Profile>): Profile {
  return {
    id: 1,
    userId: 1,
    age: 42,
    height: 178,
    weight: 180,
    gender: Gender.MALE,
    goals: [FitnessGoals.STRENGTH, FitnessGoals.GENERAL_FITNESS],
    limitations: [],
    fitnessLevel: FitnessLevels.INTERMEDIATE,
    environment: WorkoutEnvironments.COMMERCIAL_GYM,
    equipment: Object.values(AvailableEquipment),
    otherEquipment: null,
    preferredStyles: [PreferredStyles.STRENGTH, PreferredStyles.HIIT],
    availableDays: [
      PreferredDays.MONDAY,
      PreferredDays.TUESDAY,
      PreferredDays.THURSDAY,
      PreferredDays.FRIDAY,
      PreferredDays.SATURDAY,
    ],
    workoutDuration: 45,
    intensityLevel: IntensityLevels.MODERATE,
    medicalNotes: null,
    includeWarmup: true,
    includeCooldown: true,
    aiProvider: AIProvider.ANTHROPIC,
    aiModel: DEFAULT_AI_MODEL,
    timezone: "America/New_York",
    updatedAt: null,
    ...overrides,
  };
}

const duration = (targetMinutes: number): ComplianceCheck => ({
  id: "duration",
  label: `duration ±${DURATION_TOLERANCE} of ${targetMinutes}m`,
  type: "durationCompliance",
  targetMinutes,
  toleranceMinutes: DURATION_TOLERANCE,
});

const noRepeat: ComplianceCheck = {
  id: "no-repeat",
  label: "no exercise >2× per day",
  type: "noRepeatOverTwice",
};

export interface EvalScenario {
  id: string;
  category:
    | "control"
    | "exclusion"
    | "equipment"
    | "format"
    | "duration"
    | "calendar"
    | "scheduling";
  description: string;
  profile: Profile;
  customFeedback?: string;
  /** Resolved with the computed schedule so day-scoped checks can find the right day. */
  buildChecks: (schedule: PlanDaySlot[], profile: Profile) => ComplianceCheck[];
  /**
   * [GQ-02] Expectations scored against the RETURNED generation schedule
   * (reflects the scheduling override), checked by the harness directly.
   */
  expectSchedule?: {
    dayCount?: number;
    weekdays?: string[];
    firstWeekday?: string;
  };
}

/** Finds the 1-based day number a given weekday maps to for this scenario's schedule. */
function dayNumberFor(schedule: PlanDaySlot[], weekday: string): number | null {
  const slot = schedule.find((s) => s.weekday === weekday.toLowerCase());
  return slot ? slot.dayNumber : null;
}

export const SCENARIOS: EvalScenario[] = [
  // ---- Controls (no override; guard that prompt changes don't hurt the base case) ----
  {
    id: "control-strength-gym",
    category: "control",
    description: "Baseline: 5-day commercial-gym strength+HIIT, no custom request",
    profile: baseProfile({}),
    buildChecks: (_s, p) => [duration(p.workoutDuration || 45), noRepeat],
  },
  {
    id: "control-yoga-mobility",
    category: "control",
    description: "Baseline: older user, yoga+mobility at home, arthritis, no request",
    profile: baseProfile({
      age: 63,
      goals: [FitnessGoals.MOBILITY_FLEXIBILITY, FitnessGoals.RECOVERY],
      limitations: [PhysicalLimitations.ARTHRITIS],
      fitnessLevel: FitnessLevels.BEGINNER,
      environment: WorkoutEnvironments.HOME_GYM,
      equipment: [AvailableEquipment.DUMBBELLS, AvailableEquipment.FOAM_ROLLER],
      preferredStyles: [PreferredStyles.YOGA, PreferredStyles.MOBILITY],
      availableDays: [
        PreferredDays.MONDAY,
        PreferredDays.WEDNESDAY,
        PreferredDays.FRIDAY,
      ],
      workoutDuration: 30,
      intensityLevel: IntensityLevels.LOW,
    }),
    buildChecks: (_s, p) => [duration(p.workoutDuration || 30), noRepeat],
  },

  // ---- Exclusions ----
  {
    id: "exclude-burpees",
    category: "exclusion",
    description: "Explicit exclusion: no burpees",
    profile: baseProfile({ preferredStyles: [PreferredStyles.CROSSFIT, PreferredStyles.HIIT] }),
    customFeedback: "I really dislike burpees — please do not include any burpees anywhere this week.",
    buildChecks: (_s, p) => [
      { id: "no-burpee", label: 'excludes "burpee"', type: "excludes", needle: "burpee" },
      duration(p.workoutDuration || 45),
    ],
  },
  {
    id: "exclude-deadlift",
    category: "exclusion",
    description: "Explicit exclusion: no deadlifts (mirrors the user-41 deadlift incident)",
    profile: baseProfile({}),
    customFeedback: "No deadlifts of any kind this week please — I want to avoid them entirely.",
    buildChecks: (_s, p) => [
      { id: "no-deadlift", label: 'excludes "deadlift"', type: "excludes", needle: "deadlift" },
      duration(p.workoutDuration || 45),
    ],
  },
  {
    id: "exclude-two-movements",
    category: "exclusion",
    description: "Multiple exclusions: no burpees and no box jumps",
    profile: baseProfile({ preferredStyles: [PreferredStyles.CROSSFIT, PreferredStyles.FUNCTIONAL] }),
    customFeedback:
      "Bad knees on impact — please avoid burpees and box jumps completely this week.",
    buildChecks: (_s, p) => [
      { id: "no-burpee", label: 'excludes "burpee"', type: "excludes", needle: "burpee" },
      { id: "no-box-jump", label: 'excludes "box jump"', type: "excludes", needle: "box jump" },
      duration(p.workoutDuration || 45),
    ],
  },

  // ---- Equipment rules ----
  {
    id: "equipment-no-barbell",
    category: "equipment",
    description: "Equipment rule: full gym available, but user wants no barbell work",
    profile: baseProfile({}),
    customFeedback:
      "Please program dumbbells, kettlebells and machines only — no barbell exercises at all this week.",
    buildChecks: (_s, p) => [
      { id: "no-barbell", label: 'excludes "barbell"', type: "excludes", needle: "barbell" },
      duration(p.workoutDuration || 45),
    ],
  },
  {
    id: "equipment-bodyweight-travel-day",
    category: "equipment",
    description: "Day-scoped equipment rule: make the travel day bodyweight-only",
    profile: baseProfile({
      availableDays: [
        PreferredDays.MONDAY,
        PreferredDays.WEDNESDAY,
        PreferredDays.FRIDAY,
      ],
    }),
    customFeedback:
      "I travel on Wednesdays with no gym access — make Wednesday a bodyweight-only workout. Other days can use full equipment.",
    buildChecks: (schedule, p) => {
      const wed = dayNumberFor(schedule, "wednesday");
      const checks: ComplianceCheck[] = [duration(p.workoutDuration || 45)];
      if (wed) {
        checks.unshift({
          id: "bodyweight-wed",
          label: `day ${wed} (Wed) bodyweight-only`,
          type: "equipmentFreeDay",
          dayNumber: wed,
        });
      }
      return checks;
    },
  },

  // ---- Format asks ----
  {
    id: "format-amrap-each-day",
    category: "format",
    description: "Format ask: include an AMRAP finisher every day",
    profile: baseProfile({ preferredStyles: [PreferredStyles.CROSSFIT, PreferredStyles.HIIT] }),
    customFeedback:
      "I love conditioning — please finish every single day with an AMRAP block.",
    buildChecks: (_s, p) => [
      { id: "amrap-each-day", label: "AMRAP block each day", type: "blockTypeEachDay", blockType: "amrap" },
      duration(p.workoutDuration || 45),
    ],
  },
  {
    id: "format-strength-only-no-conditioning",
    category: "format",
    description: "Format ask: pure strength, no AMRAP/circuit conditioning",
    profile: baseProfile({
      goals: [FitnessGoals.STRENGTH, FitnessGoals.MUSCLE_GAIN],
      preferredStyles: [PreferredStyles.STRENGTH],
    }),
    customFeedback:
      "Pure strength training only this week — traditional sets and reps. No AMRAPs, no circuits, no HIIT conditioning.",
    buildChecks: (_s, p) => [
      { id: "no-amrap", label: "no AMRAP blocks", type: "blockTypeAbsent", blockType: "amrap" },
      { id: "no-circuit", label: "no circuit blocks", type: "blockTypeAbsent", blockType: "circuit" },
      duration(p.workoutDuration || 45),
    ],
  },

  // ---- Duration compliance (known failure family at the extremes) ----
  {
    id: "duration-60",
    category: "duration",
    description: "60-minute target must be met",
    profile: baseProfile({
      workoutDuration: 60,
      availableDays: [PreferredDays.MONDAY, PreferredDays.WEDNESDAY, PreferredDays.FRIDAY],
    }),
    buildChecks: (_s, p) => [duration(p.workoutDuration || 60), noRepeat],
  },
  {
    id: "duration-long-75",
    category: "duration",
    description: "Long session: 75-minute target must be met",
    profile: baseProfile({ workoutDuration: 75, availableDays: [PreferredDays.MONDAY, PreferredDays.WEDNESDAY, PreferredDays.FRIDAY, PreferredDays.SATURDAY] }),
    buildChecks: (_s, p) => [duration(p.workoutDuration || 75), noRepeat],
  },
  {
    id: "duration-90",
    category: "duration",
    description: "Very long session: 90-minute target must be met",
    profile: baseProfile({
      workoutDuration: 90,
      availableDays: [PreferredDays.MONDAY, PreferredDays.WEDNESDAY, PreferredDays.SATURDAY],
    }),
    buildChecks: (_s, p) => [duration(p.workoutDuration || 90), noRepeat],
  },
  {
    id: "duration-short-20",
    category: "duration",
    description: "Short session: 20-minute bodyweight target must be met",
    profile: baseProfile({
      environment: WorkoutEnvironments.BODYWEIGHT_ONLY,
      equipment: [AvailableEquipment.BODYWEIGHT],
      preferredStyles: [PreferredStyles.HIIT, PreferredStyles.FUNCTIONAL],
      workoutDuration: 20,
      availableDays: [
        PreferredDays.MONDAY,
        PreferredDays.TUESDAY,
        PreferredDays.WEDNESDAY,
        PreferredDays.THURSDAY,
      ],
    }),
    buildChecks: (_s, p) => [duration(p.workoutDuration || 20)],
  },

  // ---- Scheduling overrides (GQ-02) ----
  {
    id: "schedule-specific-days",
    category: "scheduling",
    description: "Partial week: user names specific training days (Mon/Wed/Fri)",
    profile: baseProfile({
      availableDays: [
        PreferredDays.MONDAY,
        PreferredDays.TUESDAY,
        PreferredDays.WEDNESDAY,
        PreferredDays.THURSDAY,
        PreferredDays.FRIDAY,
      ],
    }),
    customFeedback:
      "I can only get to the gym on Mondays, Wednesdays, and Fridays this week — just those three days please.",
    buildChecks: (_s, p) => [duration(p.workoutDuration || 45)],
    expectSchedule: { dayCount: 3, weekdays: ["monday", "wednesday", "friday"] },
  },
  {
    id: "schedule-fewer-days",
    category: "scheduling",
    description: "Partial week: user asks for a specific day COUNT (3)",
    profile: baseProfile({}),
    customFeedback: "I only have time for 3 workouts this week, not the usual amount.",
    buildChecks: (_s, p) => [duration(p.workoutDuration || 45)],
    expectSchedule: { dayCount: 3 },
  },
  {
    id: "schedule-weekends-only",
    category: "scheduling",
    description: "Day override: weekends only (outside the profile's weekday schedule)",
    profile: baseProfile({
      availableDays: [
        PreferredDays.MONDAY,
        PreferredDays.TUESDAY,
        PreferredDays.WEDNESDAY,
        PreferredDays.THURSDAY,
        PreferredDays.FRIDAY,
      ],
    }),
    customFeedback: "This week I can only train on the weekend — Saturday and Sunday only.",
    buildChecks: (_s, p) => [duration(p.workoutDuration || 45)],
    expectSchedule: { dayCount: 2, weekdays: ["saturday", "sunday"] },
  },

  // ---- Calendar fidelity (GQ-01 target) ----
  {
    id: "calendar-light-friday",
    category: "calendar",
    description:
      "Calendar ask: keep Friday legs-light because of a Saturday long run",
    profile: baseProfile({
      goals: [FitnessGoals.STRENGTH, FitnessGoals.ENDURANCE],
      availableDays: [
        PreferredDays.MONDAY,
        PreferredDays.TUESDAY,
        PreferredDays.WEDNESDAY,
        PreferredDays.FRIDAY,
        PreferredDays.SATURDAY,
      ],
    }),
    customFeedback:
      "I do a long run every Saturday morning, so keep Friday a light lower-body-friendly day — no heavy squats, deadlifts, or lunges on Friday so my legs are fresh.",
    buildChecks: (schedule, p) => {
      const fri = dayNumberFor(schedule, "friday");
      const checks: ComplianceCheck[] = [duration(p.workoutDuration || 45)];
      if (fri) {
        checks.unshift(
          { id: "fri-no-squat", label: `no "squat" on Fri (day ${fri})`, type: "excludesOnDay", dayNumber: fri, needle: "squat" },
          { id: "fri-no-deadlift", label: `no "deadlift" on Fri (day ${fri})`, type: "excludesOnDay", dayNumber: fri, needle: "deadlift" },
          { id: "fri-no-lunge", label: `no "lunge" on Fri (day ${fri})`, type: "excludesOnDay", dayNumber: fri, needle: "lunge" }
        );
      }
      return checks;
    },
    // [GQ-02 negative control] "keep Friday light" names a weekday for CONTENT,
    // NOT a schedule change — it must NOT shrink the 5-day week to fewer days.
    expectSchedule: { dayCount: 5 },
  },
];

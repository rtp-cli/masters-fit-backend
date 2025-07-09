import { PreferredStyles } from "@/types/profile/types";

/**
 * Determine block type based on user's preferred workout styles
 */
export function determineBlockType(
  preferredStyles: string[] | null | undefined
): string {
  if (!preferredStyles || preferredStyles.length === 0) {
    return "traditional";
  }

  // Priority order for style-to-block mapping
  const styleBlockMap: { [key: string]: string } = {
    crossfit: "amrap", // CrossFit gets AMRAP by default
    hiit: "circuit", // HIIT gets circuit format
    yoga: "flow", // Yoga gets flow format
    pilates: "flow", // Pilates gets flow format
    strength: "traditional", // Strength gets traditional sets/reps
    cardio: "circuit", // Cardio gets circuit format
    functional: "circuit", // Functional gets circuit format
    balance: "traditional", // Balance gets traditional format
    mobility: "flow", // Mobility gets flow format
    rehab: "traditional", // Rehab gets traditional format
  };

  // Find the first matching style and return its block type
  for (const style of preferredStyles) {
    if (style && typeof style === "string") {
      const normalizedStyle = style.toLowerCase().trim();
      if (styleBlockMap[normalizedStyle]) {
        return styleBlockMap[normalizedStyle];
      }
    }
  }

  return "traditional";
}

/**
 * Generate a descriptive block name based on block type and styles
 */
export function generateBlockName(
  blockType: string,
  preferredStyles: string[] | null | undefined
): string {
  const blockTypeNames: { [key: string]: string } = {
    amrap: "AMRAP Challenge",
    circuit: "Circuit Training",
    flow: "Flow Sequence",
    traditional: "Strength Training",
    emom: "EMOM Workout",
    tabata: "Tabata Intervals",
  };

  return blockTypeNames[blockType] || "Workout Block";
}

/**
 * Determine time cap for a block based on type and duration
 */
export function determineTimeCap(
  blockType: string,
  workoutDuration: number
): number | null {
  switch (blockType) {
    case "amrap":
      return Math.max(8, Math.round(workoutDuration * 0.6));
    case "circuit":
      return Math.max(10, Math.round(workoutDuration * 0.7));
    case "emom":
      return Math.max(12, Math.round(workoutDuration * 0.8));
    default:
      return null;
  }
}

/**
 * Determine rounds for a block based on type and duration
 */
export function determineRounds(
  blockType: string,
  workoutDuration: number
): number {
  switch (blockType) {
    case "circuit":
      return Math.max(2, Math.round(workoutDuration / 15));
    case "amrap":
      return 1; // AMRAP is typically 1 round for time
    case "emom":
      return Math.max(8, Math.round(workoutDuration * 0.8));
    default:
      return 1;
  }
}

/**
 * Calculate recommended sets based on workout parameters
 */
export function calculateRecommendedSets(
  blockType: string,
  workoutDuration: number,
  exerciseCount: number
): number {
  switch (blockType) {
    case "traditional":
      return Math.max(
        2,
        Math.min(5, Math.round(workoutDuration / (exerciseCount * 3)))
      );
    case "circuit":
      return Math.max(1, Math.round(workoutDuration / 20));
    case "amrap":
      return 1; // AMRAP uses time, not sets
    default:
      return 3;
  }
}

/**
 * Calculate recommended reps based on exercise type and goals
 */
export function calculateRecommendedReps(
  exerciseName: string,
  muscleGroups: string[],
  fitnessGoals: string[]
): number {
  const isCompound = muscleGroups.length > 2;
  const isStrength =
    fitnessGoals.includes("strength") || fitnessGoals.includes("muscle_gain");
  const isEndurance =
    fitnessGoals.includes("endurance") || fitnessGoals.includes("fat_loss");

  if (isCompound && isStrength) {
    return Math.floor(Math.random() * 3) + 5; // 5-8 reps for compound strength
  } else if (isCompound && isEndurance) {
    return Math.floor(Math.random() * 5) + 10; // 10-15 reps for compound endurance
  } else if (isStrength) {
    return Math.floor(Math.random() * 4) + 8; // 8-12 reps for isolation strength
  } else {
    return Math.floor(Math.random() * 6) + 12; // 12-18 reps for isolation endurance
  }
}

/**
 * Calculate rest time between sets based on exercise intensity
 */
export function calculateRestTime(
  exerciseIntensity: "low" | "medium" | "high",
  blockType: string
): number {
  if (blockType === "circuit" || blockType === "amrap") {
    return 0; // No rest in circuits/AMRAP
  }

  switch (exerciseIntensity) {
    case "high":
      return 180; // 3 minutes for high intensity
    case "medium":
      return 120; // 2 minutes for medium intensity
    case "low":
      return 60; // 1 minute for low intensity
    default:
      return 90;
  }
}

/**
 * Determine exercise intensity based on muscle groups and type
 */
export function determineExerciseIntensity(
  exerciseName: string,
  muscleGroups: string[]
): "low" | "medium" | "high" {
  const compoundKeywords = [
    "squat",
    "deadlift",
    "bench",
    "press",
    "row",
    "pull",
  ];
  const isCompound =
    muscleGroups.length > 2 ||
    compoundKeywords.some((keyword) =>
      exerciseName.toLowerCase().includes(keyword)
    );

  if (isCompound) {
    return "high";
  } else if (muscleGroups.length === 2) {
    return "medium";
  } else {
    return "low";
  }
}

/**
 * Workout Block Configuration Utilities
 * Pure functions for determining workout block characteristics
 */

/**
 * Determines block type based on preferred workout styles
 * @param preferredStyles - Array of preferred workout styles
 * @returns Block type string
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
      const normalizedStyle = style.toLowerCase();
      if (styleBlockMap[normalizedStyle]) {
        return styleBlockMap[normalizedStyle];
      }
    }
  }

  // Default to traditional if no matching style found
  return "traditional";
}

/**
 * Generates block name based on block type and preferred styles
 * @param blockType - The block type
 * @param preferredStyles - Array of preferred workout styles
 * @returns Block name string
 */
export function generateBlockName(
  blockType: string,
  preferredStyles: string[] | null | undefined
): string {
  const blockNameMap: { [key: string]: string } = {
    amrap: "AMRAP",
    circuit: "Circuit Training",
    flow: "Flow Session",
    traditional: "Strength Training",
    tabata: "Tabata",
    emom: "EMOM",
  };

  // Check if any preferred style should override the default name
  if (preferredStyles && preferredStyles.length > 0) {
    const primaryStyle = preferredStyles[0].toLowerCase();
    if (primaryStyle === "crossfit") return "CrossFit WOD";
    if (primaryStyle === "hiit") return "HIIT Circuit";
    if (primaryStyle === "yoga") return "Yoga Flow";
    if (primaryStyle === "pilates") return "Pilates Session";
  }

  return blockNameMap[blockType] || "Workout Block";
}

/**
 * Determines time cap based on block type and workout duration
 * @param blockType - The block type
 * @param workoutDuration - Total workout duration in minutes
 * @returns Time cap in minutes or null if not applicable
 */
export function determineTimeCap(
  blockType: string,
  workoutDuration: number
): number | null {
  const timeCapMap: { [key: string]: number } = {
    amrap: Math.floor(workoutDuration * 0.7), // 70% of workout duration
    circuit: Math.floor(workoutDuration * 0.6), // 60% of workout duration
    tabata: 4, // Standard Tabata is 4 minutes
    emom: Math.floor(workoutDuration * 0.8), // 80% of workout duration
  };

  return timeCapMap[blockType] || null;
}

/**
 * Determines number of rounds based on block type and workout duration
 * @param blockType - The block type
 * @param workoutDuration - Total workout duration in minutes
 * @returns Number of rounds
 */
export function determineRounds(
  blockType: string,
  workoutDuration: number
): number {
  const roundsMap: { [key: string]: number } = {
    amrap: 1, // AMRAP is typically 1 round for time
    circuit: Math.max(2, Math.floor(workoutDuration / 10)), // 1 round per 10 minutes, min 2
    tabata: 8, // Standard Tabata is 8 rounds
    emom: workoutDuration, // EMOM is 1 round per minute
    traditional: Math.max(3, Math.floor(workoutDuration / 8)), // 1 round per 8 minutes, min 3
    flow: 1, // Flow sessions are typically 1 continuous round
  };

  return roundsMap[blockType] || 3;
}

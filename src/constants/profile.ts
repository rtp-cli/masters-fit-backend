export const Gender = {
  MALE: "male",
  FEMALE: "female",
  OTHER: "other",
} as const;

export const FitnessGoals = {
  GENERAL_FITNESS: "general_fitness",
  FAT_LOSS: "fat_loss",
  ENDURANCE: "endurance",
  MUSCLE_GAIN: "muscle_gain",
  STRENGTH: "strength",
  MOBILITY_FLEXIBILITY: "mobility_flexibility",
  BALANCE: "balance",
  RECOVERY: "recovery",
} as const;

export const FitnessLevels = {
  BEGINNER: "beginner",
  INTERMEDIATE: "intermediate",
  ADVANCED: "advanced",
} as const;

export const IntensityLevels = {
  LOW: "low",
  MODERATE: "moderate",
  HIGH: "high",
} as const;

export const WorkoutEnvironments = {
  HOME_GYM: "home_gym",
  COMMERCIAL_GYM: "commercial_gym",
  BODYWEIGHT_ONLY: "bodyweight_only",
} as const;

export const PreferredDays = {
  MONDAY: "monday",
  TUESDAY: "tuesday",
  WEDNESDAY: "wednesday",
  THURSDAY: "thursday",
  FRIDAY: "friday",
  SATURDAY: "saturday",
  SUNDAY: "sunday",
} as const;

export const PhysicalLimitations = {
  KNEE_PAIN: "knee_pain",
  SHOULDER_PAIN: "shoulder_pain",
  LOWER_BACK_PAIN: "lower_back_pain",
  NECK_PAIN: "neck_pain",
  HIP_PAIN: "hip_pain",
  ANKLE_INSTABILITY: "ankle_instability",
  WRIST_PAIN: "wrist_pain",
  ELBOW_PAIN: "elbow_pain",
  ARTHRITIS: "arthritis",
  OSTEOPOROSIS: "osteoporosis",
  SCIATICA: "sciatica",
  LIMITED_RANGE_OF_MOTION: "limited_range_of_motion",
  POST_SURGERY_RECOVERY: "post_surgery_recovery",
  BALANCE_ISSUES: "balance_issues",
  CHRONIC_FATIGUE: "chronic_fatigue",
  BREATHING_ISSUES: "breathing_issues",
} as const;

export const AvailableEquipment = {
  BARBELLS: "barbells",
  BENCH: "bench",
  INCLINE_DECLINE_BENCH: "incline_decline_bench",
  PULL_UP_BAR: "pull_up_bar",
  BIKE: "bike",
  MEDICINE_BALLS: "medicine_balls",
  PLYO_BOX: "plyo_box",
  RINGS: "rings",
  RESISTANCE_BANDS: "resistance_bands",
  STABILITY_BALL: "stability_ball",
  DUMBBELLS: "dumbbells",
  KETTLEBELLS: "kettlebells",
  SQUAT_RACK: "squat_rack",
  DIP_BAR: "dip_bar",
  ROWING_MACHINE: "rowing_machine",
  SLAM_BALLS: "slam_balls",
  CABLE_MACHINE: "cable_machine",
  JUMP_ROPE: "jump_rope",
  FOAM_ROLLER: "foam_roller",
} as const;

export const PreferredStyles = {
  HIIT: "hiit",
  STRENGTH: "strength",
  CARDIO: "cardio",
  REHAB: "rehab",
  CROSSFIT: "crossfit",
  FUNCTIONAL: "functional",
  PILATES: "pilates",
  YOGA: "yoga",
  BALANCE: "balance",
  MOBILITY: "mobility",
} as const;

// Helper functions for automatic equipment assignment
export const getEquipmentForEnvironment = (environment: string): string[] => {
  switch (environment) {
    case WorkoutEnvironments.COMMERCIAL_GYM:
      // Commercial gym has comprehensive equipment available
      return [
        AvailableEquipment.BARBELLS,
        AvailableEquipment.BENCH,
        AvailableEquipment.INCLINE_DECLINE_BENCH,
        AvailableEquipment.PULL_UP_BAR,
        AvailableEquipment.BIKE,
        AvailableEquipment.MEDICINE_BALLS,
        AvailableEquipment.PLYO_BOX,
        AvailableEquipment.RINGS,
        AvailableEquipment.RESISTANCE_BANDS,
        AvailableEquipment.STABILITY_BALL,
        AvailableEquipment.DUMBBELLS,
        AvailableEquipment.KETTLEBELLS,
        AvailableEquipment.SQUAT_RACK,
        AvailableEquipment.DIP_BAR,
        AvailableEquipment.ROWING_MACHINE,
        AvailableEquipment.SLAM_BALLS,
        AvailableEquipment.CABLE_MACHINE,
        AvailableEquipment.JUMP_ROPE,
        AvailableEquipment.FOAM_ROLLER,
      ];
    case WorkoutEnvironments.BODYWEIGHT_ONLY:
      // Bodyweight only - no equipment needed
      return [];
    case WorkoutEnvironments.HOME_GYM:
    default:
      // Home gym: user must select manually, return empty array as default
      return [];
  }
};

export const shouldShowEquipmentSelection = (environment: string): boolean => {
  return environment === WorkoutEnvironments.HOME_GYM;
};

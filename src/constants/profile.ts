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
  HOME: "home",
  GYM: "gym",
  HYBRID: "hybrid",
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
  DUMBBELLS: "dumbbells",
  RESISTANCE_BANDS: "resistance_bands",
  MACHINES: "machines",
  BODYWEIGHT: "bodyweight",
  KETTLEBELLS: "kettlebells",
  MEDICINE_BALL: "medicine_ball",
  FOAM_ROLLER: "foam_roller",
  TREADMILL: "treadmill",
  BIKE: "bike",
  YOGA_MAT: "yoga_mat",
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

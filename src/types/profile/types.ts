import {
  FitnessGoals,
  FitnessLevels,
  WorkoutEnvironments,
  PreferredDays,
  PhysicalLimitations,
  AvailableEquipment,
  PreferredStyles,
  Gender,
  IntensityLevels,
} from "@/constants/profile";
import { ApiResponse } from "../common/responses";
import { User } from "@/models/user.schema";

export type FitnessGoal = (typeof FitnessGoals)[keyof typeof FitnessGoals];
export type FitnessLevel = (typeof FitnessLevels)[keyof typeof FitnessLevels];
export type WorkoutEnvironment =
  (typeof WorkoutEnvironments)[keyof typeof WorkoutEnvironments];
export type PreferredDay = (typeof PreferredDays)[keyof typeof PreferredDays];
export type PhysicalLimitation =
  (typeof PhysicalLimitations)[keyof typeof PhysicalLimitations];
export type AvailableEquipment =
  (typeof AvailableEquipment)[keyof typeof AvailableEquipment];
export type PreferredStyles =
  (typeof PreferredStyles)[keyof typeof PreferredStyles];
export type Gender = (typeof Gender)[keyof typeof Gender];
export type IntensityLevel =
  (typeof IntensityLevels)[keyof typeof IntensityLevels];

export interface Profile {
  id: number;
  userId: number;
  email?: string;
  height?: number;
  weight?: number;
  age?: number;
  gender?: Gender;
  goals?: FitnessGoal[];
  fitnessLevel?: FitnessLevel;
  limitations?: PhysicalLimitation[];
  medicalNotes?: string;
  environment?: WorkoutEnvironment;
  equipment?: AvailableEquipment[];
  preferredStyles?: PreferredStyles[];
  availableDays?: PreferredDay[];
  workoutDuration?: number;
  intensityLevel?: IntensityLevel;
  created_at: Date;
  updated_at: Date;
}

export interface ProfileResponse extends ApiResponse {
  profile: Profile;
  user?: User;
  needsOnboarding?: boolean;
}

export interface ProfilesResponse extends ApiResponse {
  profiles: Profile[];
}

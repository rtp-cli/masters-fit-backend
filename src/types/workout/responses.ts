export interface ApiResponse {
  success: boolean;
  error?: string;
}

export interface Exercise {
  id: number;
  name: string;
  description?: string;
  category: string;
  difficulty: string;
  equipment?: string;
  instructions?: string;
  link?: string;
  muscles_targeted?: string[];
  created_at: Date;
  updated_at: Date;
}

export interface WorkoutBlockExercise {
  id: number;
  workoutBlockId: number;
  exerciseId: number;
  sets?: number;
  reps?: number;
  weight?: number;
  duration?: number;
  restTime?: number;
  completed: boolean;
  notes?: string;
  order?: number;
  created_at: Date;
  updated_at: Date;
}

export interface WorkoutBlock {
  id: number;
  blockType?: string;
  blockName?: string;
  blockDurationMinutes?: number;
  timeCapMinutes?: number;
  rounds?: number;
  instructions?: string;
  order?: number;
  created_at: Date;
  updated_at: Date;
}

export interface PlanDay {
  id: number;
  workoutId: number;
  date: string;
  instructions?: string;
  name: string;
  description?: string;
  dayNumber: number;
  created_at: Date;
  updated_at: Date;
}

export interface Workout {
  id: number;
  userId: number;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  promptId: number;
  isActive?: boolean;
  completed?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WorkoutBlockWithExercise extends WorkoutBlockExercise {
  exercise: Exercise;
}

export interface WorkoutBlockWithExercises
  extends Omit<WorkoutBlock, "created_at" | "updated_at"> {
  exercises: WorkoutBlockWithExercise[];
  created_at: Date;
  updated_at: Date;
}

export interface PlanDayWithExercises
  extends Omit<PlanDay, "created_at" | "updated_at"> {
  blocks: WorkoutBlockWithExercises[];
  created_at: Date;
  updated_at: Date;
}

export interface WorkoutWithDetails extends Workout {
  planDays: PlanDayWithExercises[];
}

export interface WorkoutResponse extends ApiResponse {
  workout: WorkoutWithDetails;
}

export interface WorkoutsResponse extends ApiResponse {
  workouts: WorkoutWithDetails[];
}

export interface PlanDayResponse extends ApiResponse {
  planDay: PlanDayWithExercises;
}

export interface WorkoutBlockResponse extends ApiResponse {
  workoutBlock: WorkoutBlockWithExercises;
}

export interface WorkoutBlockExerciseResponse extends ApiResponse {
  workoutBlockExercise: WorkoutBlockWithExercise;
}

// Legacy types for backward compatibility
export interface PlanDayExercise extends WorkoutBlockExercise {
  planDayId: number;
}

export interface PlanDayWithExercise extends WorkoutBlockWithExercise {
  planDayId: number;
}

export interface PlanDayExerciseResponse extends ApiResponse {
  planDayExercise: PlanDayWithExercise;
}

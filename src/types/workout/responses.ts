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

export interface PlanDayExercise {
  id: number;
  planDayId: number;
  exerciseId: number;
  sets?: number;
  reps?: number;
  weight?: number;
  duration?: number;
  restTime?: number;
  completed: boolean;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PlanDay {
  id: number;
  workoutId: number;
  date: string;
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
  isActive: boolean;
  completed: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PlanDayWithExercise extends PlanDayExercise {
  exercise: Exercise;
}

export interface PlanDayWithExercises
  extends Omit<PlanDay, "created_at" | "updated_at"> {
  exercises: PlanDayWithExercise[];
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

export interface PlanDayExerciseResponse extends ApiResponse {
  planDayExercise: PlanDayWithExercise;
}

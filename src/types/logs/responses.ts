export interface ApiResponse {
  success: boolean;
  error?: string;
}

export interface ExerciseLog {
  id: number;
  planDayExerciseId: number;
  setsCompleted: number;
  repsCompleted: number;
  weightUsed: number;
  isComplete: boolean;
  timeTaken: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkoutLog {
  id: number;
  workoutId: number;
  isComplete: boolean;
  totalTimeTaken: number | null;
  completedExercises: number[] | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExerciseLogsResponse extends ApiResponse {
  logs: ExerciseLog[];
}

export interface ExerciseLogResponse extends ApiResponse {
  log: ExerciseLog;
}

export interface WorkoutLogResponse extends ApiResponse {
  log: WorkoutLog;
}

export interface WorkoutLogOrNullResponse extends ApiResponse {
  log: WorkoutLog | null;
}

export interface WorkoutLogsResponse extends ApiResponse {
  logs: WorkoutLog[];
}

export interface CompletedExercisesResponse extends ApiResponse {
  completedExercises: number[];
  count: number;
}

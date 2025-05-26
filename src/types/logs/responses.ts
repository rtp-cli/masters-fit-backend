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
  status: string;
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

export interface ApiResponse {
  success: boolean;
  error?: string;
}

// Enhanced exercise log interface
export interface ExerciseLog {
  id: number;
  planDayExerciseId: number;
  setsCompleted: number | null;
  repsCompleted: number | null;
  weightUsed: number | null;
  durationCompleted: number | null;
  roundsCompleted: number | null;
  restTimeTaken: number | null;
  timeTaken: number | null;
  isComplete: boolean;
  isSkipped: boolean;
  notes: string | null;
  difficulty: string | null;
  rating: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// New block log interface
export interface BlockLog {
  id: number;
  workoutBlockId: number;
  roundsCompleted: number | null;
  timeCapMinutes: number | null;
  actualTimeMinutes: number | null;
  totalReps: number | null;
  totalDuration: number | null;
  score: string | null;
  isComplete: boolean;
  isSkipped: boolean;
  notes: string | null;
  difficulty: string | null;
  rating: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// New plan day log interface
export interface PlanDayLog {
  id: number;
  planDayId: number;
  totalTimeMinutes: number | null;
  blocksCompleted: number | null;
  exercisesCompleted: number | null;
  totalVolume: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  isComplete: boolean;
  isSkipped: boolean;
  notes: string | null;
  difficulty: string | null;
  rating: number | null;
  mood: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Enhanced workout log interface
export interface WorkoutLog {
  id: number;
  workoutId: number;
  totalTimeMinutes: number | null;
  daysCompleted: number | null;
  totalDays: number | null;
  totalVolume: number | null;
  averageRating: number | null;
  completedExercises: number[] | null;
  completedBlocks: number[] | null;
  completedDays: number[] | null;
  isComplete: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Progress tracking interfaces
export interface ProgressMetrics {
  completed: number;
  total: number;
  percentage: number;
}

export interface WorkoutProgress {
  workoutLog: WorkoutLog;
  progress: {
    exercises: ProgressMetrics;
    blocks: ProgressMetrics;
    days: ProgressMetrics;
  };
}

export interface PlanDayProgress {
  planDayLog: PlanDayLog;
  progress: {
    exercises: ProgressMetrics;
    blocks: ProgressMetrics;
  };
}

// Response interfaces for exercise logs
export interface ExerciseLogsResponse extends ApiResponse {
  logs: ExerciseLog[];
}

export interface ExerciseLogResponse extends ApiResponse {
  log: ExerciseLog;
}

// Response interfaces for block logs
export interface BlockLogsResponse extends ApiResponse {
  logs: BlockLog[];
}

export interface BlockLogResponse extends ApiResponse {
  log: BlockLog;
}

// Response interfaces for plan day logs
export interface PlanDayLogsResponse extends ApiResponse {
  logs: PlanDayLog[];
}

export interface PlanDayLogResponse extends ApiResponse {
  log: PlanDayLog;
}

// Response interfaces for workout logs
export interface WorkoutLogResponse extends ApiResponse {
  log: WorkoutLog;
}

export interface WorkoutLogOrNullResponse extends ApiResponse {
  log: WorkoutLog | null;
}

export interface WorkoutLogsResponse extends ApiResponse {
  logs: WorkoutLog[];
}

// Progress response interfaces
export interface WorkoutProgressResponse extends ApiResponse {
  progress: WorkoutProgress | null;
}

export interface PlanDayProgressResponse extends ApiResponse {
  progress: PlanDayProgress | null;
}

// Legacy response interfaces (for backward compatibility)
export interface CompletedExercisesResponse extends ApiResponse {
  completedExercises: number[];
  count: number;
}

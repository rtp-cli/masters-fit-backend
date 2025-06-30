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

export interface ExercisesResponse extends ApiResponse {
  exercises: Exercise[];
}

export interface ExerciseResponse extends ApiResponse {
  exercise: Exercise;
}

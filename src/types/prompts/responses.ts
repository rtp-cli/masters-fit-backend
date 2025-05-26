import { ApiResponse } from "../common/responses";

export interface Prompt {
  id: number;
  userId: number;
  prompt: string;
  response: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserPromptsResponse extends ApiResponse {
  prompts: Prompt[];
}

export interface CreatePromptResponse extends ApiResponse {
  prompt: Prompt;
}

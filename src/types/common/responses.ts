export interface ApiResponse<T = void> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface ApiErrorResponse extends ApiResponse {
  success: false;
  error: string;
} 
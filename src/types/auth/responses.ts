import { ApiResponse } from "@/types/common/responses";

// Define the user response type inline to avoid circular dependencies
export interface AuthUserResponse {
  id: number;
  email: string;
  name: string;
  needsOnboarding: boolean | null;
  waiverAcceptedAt: Date | null;
  waiverVersion: string | null;
}

/**
 * @description Response type for auth verification endpoints
 */
export interface AuthVerifyResponse {
  success: boolean;
  error?: string;
  needsOnboarding?: boolean;
  needsWaiverUpdate?: boolean;
  user?: AuthUserResponse;
  email?: string;
  token?: string;
  refreshToken?: string;
}

/**
 * @description Response type for auth login endpoints
 */
export interface AuthLoginResponse {
  success: boolean;
  error?: string;
  message?: string;
  authCode?: string;
  userExists?: boolean;
  needsOnboarding?: boolean;
}

export interface AuthSignupResponse {
  success: boolean;
  error?: string;
  message?: string;
  user?: AuthUserResponse;
  needsOnboarding?: boolean;
}

/**
 * @description Response type for token refresh endpoint
 */
export interface AuthRefreshResponse {
  success: boolean;
  error?: string;
  token?: string;
  refreshToken?: string;
}

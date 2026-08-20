import { ApiResponse } from "@/types/common/responses";

// Define the user response type inline to avoid circular dependencies
export interface AuthUserResponse {
  id: number;
  email: string;
  name: string;
  needsOnboarding: boolean | null;
  waiverAcceptedAt: Date | null;
  waiverVersion: string | null;
  themeMode: string | null;
  colorTheme: string | null;
  // Whether this user is in the ADMIN_USER_IDS allowlist. Drives admin-only
  // client UI (e.g. the Developer Tools / Impersonate reveal in Settings).
  isAdmin: boolean;
}

/**
 * @description Response type for auth verification endpoints
 */
export interface AuthVerifyResponse {
  success: boolean;
  error?: string;
  // §4.4 — machine-readable verify failure: INVALID_CODE | EXPIRED_CODE | CODE_EXHAUSTED
  errorCode?: string;
  // §4.4 — remaining attempts on the code (drives the "n tries left" copy)
  attemptsLeft?: number;
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
  needsWaiverUpdate?: boolean;
  // §5 — the authenticated (onboarding-token) path returns a real session so the
  // merged client goes straight to the waiver; the legacy path omits these.
  token?: string;
  refreshToken?: string;
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

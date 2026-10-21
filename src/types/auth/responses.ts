import { ApiResponse } from "@/types/common/responses";

// Define the user response type inline to avoid circular dependencies
export interface AuthUserResponse {
  id: number;
  // At least one of email / phone is always set. Phone-only accounts (SMS
  // sign-in) have a null email until they add one in Settings.
  email: string | null;
  // E.164, e.g. "+13125550123".
  phone: string | null;
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
  // Set instead of `email` when a NEW user verified by SMS (onboarding token).
  phone?: string;
  token?: string;
  refreshToken?: string;
}

/**
 * @description Response for the Settings "Add email" / "Add phone" flows.
 */
export interface AuthContactResponse {
  success: boolean;
  error?: string;
  // INVALID_CODE | EXPIRED_CODE | CODE_EXHAUSTED | TAKEN | INVALID_PHONE |
  // SMS_UNAVAILABLE | RATE_LIMITED
  errorCode?: string;
  attemptsLeft?: number;
  user?: AuthUserResponse;
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

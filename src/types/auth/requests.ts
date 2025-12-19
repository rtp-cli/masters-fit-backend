export interface EmailAuthRequest {
  email: string;
}

export interface SignUpRequest {
  email: string;
  name: string;
}

export interface AuthCodeRequest {
  authCode: string;
  email?: string; // Optional email for bypass OTP validation
}

export interface AcceptWaiverRequest {
  version: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

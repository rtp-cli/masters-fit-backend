export interface EmailAuthRequest {
  email: string;
}

export interface SignUpRequest {
  email: string;
  name: string;
}

export interface AuthCodeRequest {
  authCode: string;
}

export interface AcceptWaiverRequest {
  version: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

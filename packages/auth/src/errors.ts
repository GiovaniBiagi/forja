/** Typed error class for auth failures. Includes an error code and HTTP status. */
export class AuthError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code (e.g., "INVALID_CREDENTIALS"). */
    public code: string,
    /** Suggested HTTP status code for this error. Defaults to 400. */
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const Errors = {
  emailAlreadyExists: () =>
    new AuthError("Email already registered", "EMAIL_EXISTS", 409),
  invalidCredentials: () =>
    new AuthError("Invalid email or password", "INVALID_CREDENTIALS", 401),
  invalidToken: () =>
    new AuthError("Invalid or expired token", "INVALID_TOKEN", 401),
  userNotFound: () =>
    new AuthError("User not found", "USER_NOT_FOUND", 404),
  forbidden: () =>
    new AuthError("Insufficient permissions", "FORBIDDEN", 403),
  tokenRevoked: () =>
    new AuthError("Token has been revoked", "TOKEN_REVOKED", 401),
  featureNotConfigured: (feature: string) =>
    new AuthError(`${feature} requires additional configuration`, "FEATURE_NOT_CONFIGURED", 500),
  refreshTokenReuse: () =>
    new AuthError("Refresh token reuse detected", "REFRESH_TOKEN_REUSE", 401),
  resetTokenExpired: () =>
    new AuthError("Reset token has expired", "RESET_TOKEN_EXPIRED", 400),
  resetTokenUsed: () =>
    new AuthError("Reset token has already been used", "RESET_TOKEN_USED", 400),
  resetTokenInvalid: () =>
    new AuthError("Invalid reset token", "RESET_TOKEN_INVALID", 400),
  verificationTokenExpired: () =>
    new AuthError("Verification token has expired", "VERIFICATION_TOKEN_EXPIRED", 400),
  verificationTokenUsed: () =>
    new AuthError("Email has already been verified", "VERIFICATION_TOKEN_USED", 400),
  verificationTokenInvalid: () =>
    new AuthError("Invalid verification token", "VERIFICATION_TOKEN_INVALID", 400),
  rateLimited: (retryAfter?: number) =>
    new AuthError(
      `Too many requests${retryAfter ? `, retry after ${retryAfter} seconds` : ""}`,
      "RATE_LIMITED",
      429
    ),
} as const;

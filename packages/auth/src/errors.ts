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
} as const;

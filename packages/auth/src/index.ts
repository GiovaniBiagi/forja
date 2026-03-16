export { createAuthService } from "./service.js";
export type { AuthService, AuthServiceConfig } from "./service.js";

export { hashPassword, verifyPassword } from "./password.js";

export {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  TOKEN_AUDIENCE,
} from "./tokens.js";
export type { TokenConfig, TokenPayload } from "./tokens.js";

export { createAuthSchemas } from "./schemas.js";
export type { AuthSchemas } from "./schemas.js";

export type { AuthStorage, StoredUser, CreateUserInput, PublicUser } from "./types.js";

export { AuthError, Errors } from "./errors.js";

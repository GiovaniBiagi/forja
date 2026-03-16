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
export type { TokenConfig } from "./tokens.js";

export {
  Role,
  RegisterInput,
  LoginInput,
  RefreshInput,
  TokenPayload,
  AuthUser,
} from "./schemas.js";

export type { AuthStorage, StoredUser } from "./types.js";

export { AuthError, Errors } from "./errors.js";

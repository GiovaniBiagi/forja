/**
 * Storage adapter interface. Consumers implement this to plug in their own
 * database layer (Prisma, Drizzle, raw SQL, etc.).
 */
export interface AuthStorage {
  /** Finds a user by email within a specific tenant. Returns `null` if not found. */
  findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null>;
  /** Creates a new user and returns the public user data (without password hash). */
  createUser(input: CreateUserInput): Promise<PublicUser>;
  /** Finds a user by ID within a specific tenant. Returns `null` if not found. */
  findUserById(id: string, tenantId: string): Promise<PublicUser | null>;
}

/** Input passed to the storage adapter when creating a user. */
export interface CreateUserInput {
  email: string;
  name: string;
  role: string;
  tenantId: string;
  passwordHash: string;
}

/** Public user data returned by storage (no password hash). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

/** Internal user representation that includes the password hash. */
export interface StoredUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  passwordHash: string;
}

// -- Optional feature interfaces (all opt-in) --

/** Token blacklist for logout / token invalidation. */
export interface TokenBlacklist {
  /** Adds a token JTI to the blacklist. `expiresAt` allows auto-cleanup of expired entries. */
  add(jti: string, expiresAt: Date): Promise<void>;
  /** Returns true if the JTI has been blacklisted. */
  isBlacklisted(jti: string): Promise<boolean>;
}

/** Server-side refresh token store for token rotation. */
export interface RefreshTokenStore {
  /** Stores a new refresh token. `familyId` groups tokens in a rotation chain. */
  store(input: { tokenHash: string; userId: string; tenantId: string; familyId: string; expiresAt: Date }): Promise<void>;
  /** Finds a refresh token by its hash. */
  find(tokenHash: string): Promise<{ userId: string; tenantId: string; familyId: string; revoked: boolean; expiresAt: Date } | null>;
  /** Revokes a single refresh token. */
  revoke(tokenHash: string): Promise<void>;
  /** Revokes ALL tokens in a family (breach detection). */
  revokeFamily(familyId: string): Promise<void>;
}

/** Storage for password reset tokens. */
export interface PasswordResetStorage {
  /** Stores a hashed reset token. */
  createResetToken(input: { tokenHash: string; userId: string; tenantId: string; expiresAt: Date }): Promise<void>;
  /** Finds a reset token by its hash. */
  findResetToken(tokenHash: string): Promise<{ userId: string; tenantId: string; expiresAt: Date; usedAt: Date | null } | null>;
  /** Marks a reset token as used. */
  markResetTokenUsed(tokenHash: string): Promise<void>;
}

/** Storage for updating a user's password. Separate from AuthStorage to avoid breaking existing implementations. */
export interface PasswordUpdateStorage {
  /** Updates the password hash for a user. */
  updatePassword(userId: string, tenantId: string, passwordHash: string): Promise<void>;
}

/** Storage for email verification tokens. */
export interface EmailVerificationStorage {
  /** Stores a hashed verification token. */
  createVerificationToken(input: { tokenHash: string; userId: string; tenantId: string; expiresAt: Date }): Promise<void>;
  /** Finds a verification token by its hash. */
  findVerificationToken(tokenHash: string): Promise<{ userId: string; tenantId: string; expiresAt: Date; usedAt: Date | null } | null>;
  /** Marks a verification token as used. */
  markVerificationTokenUsed(tokenHash: string): Promise<void>;
  /** Marks a user's email as verified. */
  markEmailVerified(userId: string, tenantId: string): Promise<void>;
}

/** Rate limiter interface. Consumers provide the implementation (in-memory, Redis, etc.). */
export interface RateLimiter {
  /**
   * Checks if an action is allowed and consumes a token if so.
   * @param key - Identifier (e.g., IP address, email+tenantId).
   * @param action - The action being rate-limited (e.g., "login", "register").
   * @returns Whether the request is allowed and retry-after info.
   */
  consume(key: string, action: string): Promise<RateLimitResult>;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the limit resets. Only meaningful when `allowed` is false. */
  retryAfter?: number;
}

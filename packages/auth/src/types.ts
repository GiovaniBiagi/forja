import type { AuthUser, RegisterInput } from "./schemas.js";

/**
 * Storage adapter interface. Consumers implement this to plug in their own
 * database layer (Prisma, Drizzle, raw SQL, etc.).
 */
export interface AuthStorage {
  /** Finds a user by email within a specific tenant. Returns `null` if not found. */
  findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null>;
  /** Creates a new user and returns the public user data (without password hash). */
  createUser(input: RegisterInput & { passwordHash: string }): Promise<AuthUser>;
  /** Finds a user by ID within a specific tenant. Returns `null` if not found. */
  findUserById(id: string, tenantId: string): Promise<AuthUser | null>;
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

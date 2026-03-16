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

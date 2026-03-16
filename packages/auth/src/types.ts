import type { AuthUser, RegisterInput } from "./schemas.js";

/**
 * Storage adapter interface — consumers implement this
 * to plug in their own database (Prisma, Drizzle, raw SQL, etc.)
 */
export interface AuthStorage {
  findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null>;
  createUser(input: RegisterInput & { passwordHash: string }): Promise<AuthUser>;
  findUserById(id: string, tenantId: string): Promise<AuthUser | null>;
}

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  passwordHash: string;
}

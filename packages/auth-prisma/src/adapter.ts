import type { AuthStorage, CreateUserInput, PublicUser, StoredUser } from "@forja/auth";

/**
 * Minimum required shape of the Prisma user delegate.
 * Your Prisma model must have at least: id, email, name, role, tenantId, passwordHash.
 * You can add any extra fields — the adapter only reads/writes the ones it needs.
 */
export interface PrismaUserDelegate {
  findFirst(args: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
  create(args: {
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

/**
 * Creates an AuthStorage adapter backed by a Prisma user delegate.
 * Does not own the Prisma schema — your app defines the User model.
 *
 * Minimum required fields on your User model:
 * - id: String (primary key)
 * - email: String
 * - name: String
 * - role: String
 * - tenantId: String
 * - passwordHash: String
 * - @@unique([email, tenantId])
 *
 * @param userDelegate - Your Prisma client's user delegate (e.g., `prisma.user`).
 * @returns An AuthStorage implementation.
 */
export function createPrismaAuthStorage(userDelegate: PrismaUserDelegate): AuthStorage {
  return {
    async findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null> {
      const user = await userDelegate.findFirst({
        where: { email, tenantId },
      });

      if (!user) return null;

      return user as unknown as StoredUser;
    },

    async createUser(input: CreateUserInput): Promise<PublicUser> {
      const user = await userDelegate.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          tenantId: input.tenantId,
          passwordHash: input.passwordHash,
        },
      });

      return {
        id: user.id as string,
        email: user.email as string,
        name: user.name as string,
        role: user.role as string,
        tenantId: user.tenantId as string,
      };
    },

    async findUserById(id: string, tenantId: string): Promise<PublicUser | null> {
      const user = await userDelegate.findFirst({
        where: { id, tenantId },
      });

      if (!user) return null;

      return {
        id: user.id as string,
        email: user.email as string,
        name: user.name as string,
        role: user.role as string,
        tenantId: user.tenantId as string,
      };
    },
  };
}

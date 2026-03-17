import type {
  AuthStorage,
  CreateUserInput,
  PublicUser,
  StoredUser,
  TokenBlacklist,
  RefreshTokenStore,
  PasswordResetStorage,
  PasswordUpdateStorage,
  EmailVerificationStorage,
} from "@forjakit/auth";

/**
 * Minimum required shape of the Prisma user delegate.
 * Your Prisma model must have at least: id, email, name, role, tenantId, passwordHash.
 * You can add any extra fields — the adapter only reads/writes the ones it needs.
 */
export interface PrismaUserDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update?(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

/** Minimum required shape of a Prisma delegate for token-like models. */
export interface PrismaTokenDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
}

/**
 * Creates an AuthStorage adapter backed by a Prisma user delegate.
 * @param userDelegate - Your Prisma client's user delegate (e.g., `prisma.user`).
 * @returns An AuthStorage implementation.
 */
export function createPrismaAuthStorage(userDelegate: PrismaUserDelegate): AuthStorage {
  return {
    async findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null> {
      const user = await userDelegate.findFirst({ where: { email, tenantId } });
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
      const user = await userDelegate.findFirst({ where: { id, tenantId } });
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

/**
 * Creates a TokenBlacklist adapter backed by a Prisma delegate.
 * Required model fields: id, jti (unique), expiresAt.
 * @param delegate - Prisma delegate for the blacklisted tokens model.
 * @returns A TokenBlacklist implementation.
 */
export function createPrismaTokenBlacklist(delegate: PrismaTokenDelegate): TokenBlacklist {
  return {
    async add(jti: string, expiresAt: Date): Promise<void> {
      await delegate.create({ data: { jti, expiresAt } });
    },
    async isBlacklisted(jti: string): Promise<boolean> {
      const entry = await delegate.findFirst({ where: { jti } });
      return entry !== null;
    },
  };
}

/**
 * Creates a RefreshTokenStore adapter backed by a Prisma delegate.
 * Required model fields: id, tokenHash (unique), userId, tenantId, familyId, revoked, expiresAt.
 * @param delegate - Prisma delegate for the refresh tokens model.
 * @returns A RefreshTokenStore implementation.
 */
export function createPrismaRefreshTokenStore(delegate: PrismaTokenDelegate): RefreshTokenStore {
  return {
    async store(input) {
      await delegate.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          tenantId: input.tenantId,
          familyId: input.familyId,
          revoked: false,
          expiresAt: input.expiresAt,
        },
      });
    },
    async find(tokenHash) {
      const token = await delegate.findFirst({ where: { tokenHash } });
      if (!token) return null;
      return {
        userId: token.userId as string,
        tenantId: token.tenantId as string,
        familyId: token.familyId as string,
        revoked: token.revoked as boolean,
        expiresAt: token.expiresAt as Date,
      };
    },
    async revoke(tokenHash) {
      await delegate.update({ where: { tokenHash }, data: { revoked: true } });
    },
    async revokeFamily(familyId) {
      await delegate.updateMany({ where: { familyId }, data: { revoked: true } });
    },
  };
}

/**
 * Creates a PasswordResetStorage adapter backed by a Prisma delegate.
 * Required model fields: id, tokenHash (unique), userId, tenantId, expiresAt, usedAt.
 * @param delegate - Prisma delegate for the password reset tokens model.
 * @returns A PasswordResetStorage implementation.
 */
export function createPrismaPasswordResetStorage(delegate: PrismaTokenDelegate): PasswordResetStorage {
  return {
    async createResetToken(input) {
      await delegate.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          tenantId: input.tenantId,
          expiresAt: input.expiresAt,
          usedAt: null,
        },
      });
    },
    async findResetToken(tokenHash) {
      const token = await delegate.findFirst({ where: { tokenHash } });
      if (!token) return null;
      return {
        userId: token.userId as string,
        tenantId: token.tenantId as string,
        expiresAt: token.expiresAt as Date,
        usedAt: token.usedAt as Date | null,
      };
    },
    async markResetTokenUsed(tokenHash) {
      await delegate.update({ where: { tokenHash }, data: { usedAt: new Date() } });
    },
  };
}

/**
 * Creates a PasswordUpdateStorage adapter backed by a Prisma user delegate.
 * Requires the user delegate to have an `update` method.
 * @param userDelegate - Prisma user delegate with update capability.
 * @returns A PasswordUpdateStorage implementation.
 */
export function createPrismaPasswordUpdateStorage(userDelegate: PrismaUserDelegate): PasswordUpdateStorage {
  return {
    async updatePassword(userId: string, tenantId: string, passwordHash: string) {
      if (!userDelegate.update) throw new Error("User delegate must support update for password changes");
      await userDelegate.update({ where: { id: userId }, data: { passwordHash } });
    },
  };
}

/**
 * Creates an EmailVerificationStorage adapter backed by Prisma delegates.
 * Token model required fields: id, tokenHash (unique), userId, tenantId, expiresAt, usedAt.
 * User model requires an `update` method to set emailVerified.
 * @param tokenDelegate - Prisma delegate for verification tokens.
 * @param userDelegate - Prisma user delegate with update capability.
 * @returns An EmailVerificationStorage implementation.
 */
export function createPrismaEmailVerificationStorage(
  tokenDelegate: PrismaTokenDelegate,
  userDelegate: PrismaUserDelegate
): EmailVerificationStorage {
  return {
    async createVerificationToken(input) {
      await tokenDelegate.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          tenantId: input.tenantId,
          expiresAt: input.expiresAt,
          usedAt: null,
        },
      });
    },
    async findVerificationToken(tokenHash) {
      const token = await tokenDelegate.findFirst({ where: { tokenHash } });
      if (!token) return null;
      return {
        userId: token.userId as string,
        tenantId: token.tenantId as string,
        expiresAt: token.expiresAt as Date,
        usedAt: token.usedAt as Date | null,
      };
    },
    async markVerificationTokenUsed(tokenHash) {
      await tokenDelegate.update({ where: { tokenHash }, data: { usedAt: new Date() } });
    },
    async markEmailVerified(userId: string, tenantId: string) {
      if (!userDelegate.update) throw new Error("User delegate must support update for email verification");
      await userDelegate.update({ where: { id: userId }, data: { emailVerified: true } });
    },
  };
}

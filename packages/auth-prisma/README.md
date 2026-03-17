# @forja/auth-prisma

Prisma storage adapters for `@forja/auth`. Implements all storage interfaces (`AuthStorage`, `TokenBlacklist`, `RefreshTokenStore`, `PasswordResetStorage`, `PasswordUpdateStorage`, `EmailVerificationStorage`) using Prisma model delegates, so you can plug a Prisma-backed database into the auth service with zero custom SQL.

## Installation

```bash
pnpm add @forja/auth-prisma
```

Peer dependencies: `@forja/auth`.

## Required Prisma Schema

The adapters expect specific model fields. The exact model names can vary -- what matters is that the delegate you pass has the correct field structure.

```prisma
model User {
  id            String    @id @default(cuid())
  email         String
  name          String
  role          String
  tenantId      String
  passwordHash  String
  emailVerified Boolean   @default(false)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([email, tenantId])
  @@index([tenantId])
}

model TokenBlacklist {
  id        String   @id @default(cuid())
  jti       String   @unique
  expiresAt DateTime

  @@index([jti])
}

model RefreshToken {
  id        String   @id @default(cuid())
  tokenHash String   @unique
  userId    String
  tenantId  String
  familyId  String
  revoked   Boolean  @default(false)
  expiresAt DateTime

  @@index([tokenHash])
  @@index([familyId])
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  tokenHash String    @unique
  userId    String
  tenantId  String
  expiresAt DateTime
  usedAt    DateTime?

  @@index([tokenHash])
}

model EmailVerificationToken {
  id        String    @id @default(cuid())
  tokenHash String    @unique
  userId    String
  tenantId  String
  expiresAt DateTime
  usedAt    DateTime?

  @@index([tokenHash])
}
```

You only need the models for the features you use. If you only use basic auth (no logout, no refresh rotation, no password reset, no email verification), only the `User` model is required.

## Creating Storage Adapters

### AuthStorage (user persistence)

```ts
import { createPrismaAuthStorage } from "@forja/auth-prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const authStorage = createPrismaAuthStorage(prisma.user);
```

Methods implemented: `findUserByEmail`, `createUser`, `findUserById`.

### TokenBlacklist (logout)

```ts
import { createPrismaTokenBlacklist } from "@forja/auth-prisma";

const tokenBlacklist = createPrismaTokenBlacklist(prisma.tokenBlacklist);
```

Methods implemented: `add`, `isBlacklisted`.

### RefreshTokenStore (token rotation)

```ts
import { createPrismaRefreshTokenStore } from "@forja/auth-prisma";

const refreshTokenStore = createPrismaRefreshTokenStore(prisma.refreshToken);
```

Methods implemented: `store`, `find`, `revoke`, `revokeFamily`.

The `revokeFamily` method uses `updateMany` to revoke all tokens in a family at once (breach detection).

### PasswordResetStorage (password reset tokens)

```ts
import { createPrismaPasswordResetStorage } from "@forja/auth-prisma";

const passwordResetStorage = createPrismaPasswordResetStorage(prisma.passwordResetToken);
```

Methods implemented: `createResetToken`, `findResetToken`, `markResetTokenUsed`.

### PasswordUpdateStorage (updating user passwords)

```ts
import { createPrismaPasswordUpdateStorage } from "@forja/auth-prisma";

const passwordUpdateStorage = createPrismaPasswordUpdateStorage(prisma.user);
```

Methods implemented: `updatePassword`.

This adapter reuses the same Prisma user delegate as `createPrismaAuthStorage`. It requires the delegate to have an `update` method.

### EmailVerificationStorage (email verification)

```ts
import { createPrismaEmailVerificationStorage } from "@forja/auth-prisma";

const emailVerificationStorage = createPrismaEmailVerificationStorage(
  prisma.emailVerificationToken,
  prisma.user
);
```

Methods implemented: `createVerificationToken`, `findVerificationToken`, `markVerificationTokenUsed`, `markEmailVerified`.

This adapter takes two delegates: the token delegate for verification token CRUD, and the user delegate for setting `emailVerified = true`.

## Duck-Typed Delegates

The adapters do not import or depend on `@prisma/client` directly. Instead, they define minimal delegate interfaces that describe the shape of the Prisma model methods they use.

This means:

- No version coupling with your Prisma client.
- Any object that satisfies the delegate interface works (useful for testing with mocks).
- You pass `prisma.user` (or whatever your model is named) and the adapter uses the methods it needs.

### PrismaUserDelegate

```ts
interface PrismaUserDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update?(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}
```

The `update` method is optional on `PrismaUserDelegate`. It is only required if you use `createPrismaPasswordUpdateStorage` or `createPrismaEmailVerificationStorage`. If you call those adapters with a delegate missing `update`, they throw a runtime error.

### PrismaTokenDelegate

```ts
interface PrismaTokenDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}
```

Used by `createPrismaTokenBlacklist`, `createPrismaRefreshTokenStore`, `createPrismaPasswordResetStorage`, and `createPrismaEmailVerificationStorage`.

## Full Integration Example

```ts
import { createAuthService } from "@forja/auth";
import {
  createPrismaAuthStorage,
  createPrismaTokenBlacklist,
  createPrismaRefreshTokenStore,
  createPrismaPasswordResetStorage,
  createPrismaPasswordUpdateStorage,
  createPrismaEmailVerificationStorage,
} from "@forja/auth-prisma";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

const roles = z.enum(["admin", "professional", "client"]);

const service = createAuthService({
  storage: createPrismaAuthStorage(prisma.user),
  tokens: { secret: process.env.JWT_SECRET! },
  roles,
  defaultRole: "client",
  tokenBlacklist: createPrismaTokenBlacklist(prisma.tokenBlacklist),
  refreshTokenStore: createPrismaRefreshTokenStore(prisma.refreshToken),
  passwordReset: {
    storage: createPrismaPasswordResetStorage(prisma.passwordResetToken),
    passwordStorage: createPrismaPasswordUpdateStorage(prisma.user),
  },
  emailVerification: {
    storage: createPrismaEmailVerificationStorage(
      prisma.emailVerificationToken,
      prisma.user
    ),
  },
});

// Register a user
const { user, accessToken, refreshToken } = await service.register({
  email: "jane@example.com",
  password: "Str0ng!Pass",
  name: "Jane Doe",
  tenantId: "tenant-1",
});

// Authenticate
const authedUser = await service.authenticate(accessToken);

// Logout
await service.logout(accessToken);
```

## Exports

```ts
export {
  createPrismaAuthStorage,
  createPrismaTokenBlacklist,
  createPrismaRefreshTokenStore,
  createPrismaPasswordResetStorage,
  createPrismaPasswordUpdateStorage,
  createPrismaEmailVerificationStorage,
} from "@forja/auth-prisma";

export type {
  PrismaUserDelegate,
  PrismaTokenDelegate,
} from "@forja/auth-prisma";
```

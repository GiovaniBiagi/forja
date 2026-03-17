# @forjakit/auth

Framework-agnostic authentication service for any application that needs user registration, login, JWT tokens, role-based authorization, password reset, and email verification. The core package contains zero framework or database dependencies -- it defines the business logic, validation schemas, token management, and security utilities. Storage and HTTP are handled by companion adapter packages.

## Installation

```bash
pnpm add @forjakit/auth
```

Peer dependency: `zod >= 3.24`.

## Core Concepts

### AuthService

The central object returned by `createAuthService()`. Provides all auth operations: register, login, refresh, authenticate, authorize, logout, password reset, and email verification. All methods validate input through Zod schemas before executing business logic.

### Consumer-Defined Roles

Roles are not hardcoded. You define them as a Zod enum and pass them to the service. The generic flows through the entire system -- all methods return and accept your specific role type.

```ts
import { z } from "zod";

const roles = z.enum(["admin", "professional", "client"]);
// TypeScript infers: "admin" | "professional" | "client"
```

### JWT Tokens

The service uses two JWT tokens with separate audiences to prevent token confusion:

| Token | Audience | Default Expiry | Purpose |
| ----- | -------- | -------------- | ------- |
| Access token | `forja:access` | 15 minutes | Short-lived, used for API authorization |
| Refresh token | `forja:refresh` | 7 days | Long-lived, used to obtain new token pairs |

Both tokens are signed with HS256 and include `iss` (issuer), `aud` (audience), `sub` (user ID), `jti` (unique ID), `exp` (expiration), and custom claims (`email`, `name`, `role`, `tenantId`).

### Storage Interfaces

The service does not access a database directly. Instead, you provide implementations of storage interfaces (or use `@forjakit/auth-prisma`). All interfaces are opt-in -- you only implement what you need.

## Creating a Service

```ts
import { createAuthService } from "@forjakit/auth";
import { z } from "zod";

const roles = z.enum(["admin", "professional", "client"]);

const service = createAuthService({
  storage: myAuthStorage,          // implements AuthStorage
  tokens: {
    secret: process.env.JWT_SECRET!,
    accessTokenExpiry: "15m",      // default: "15m"
    refreshTokenExpiry: "7d",      // default: "7d"
    issuer: "forja",               // default: "forja"
  },
  roles,
  defaultRole: "client",
  // Optional features:
  tokenBlacklist: myTokenBlacklist,     // enables logout
  refreshTokenStore: myRefreshStore,    // enables rotation + breach detection
  passwordReset: {                      // enables password reset flow
    storage: myPasswordResetStorage,
    passwordStorage: myPasswordUpdateStorage,
    tokenExpiry: 60 * 60 * 1000,        // default: 1 hour
  },
  emailVerification: {                  // enables email verification flow
    storage: myEmailVerificationStorage,
    tokenExpiry: 24 * 60 * 60 * 1000,   // default: 24 hours
  },
});
```

### AuthServiceConfig

| Field | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `storage` | `AuthStorage` | Yes | -- | Storage adapter for persisting and querying users |
| `tokens` | `TokenConfig` | Yes | -- | JWT token configuration (secret, expiry, issuer) |
| `roles` | `ZodEnum` | Yes | -- | Zod enum defining valid roles for this project |
| `defaultRole` | `z.infer<T>` | Yes | -- | Default role assigned when none is provided during registration |
| `tokenBlacklist` | `TokenBlacklist` | No | -- | Enables logout / token invalidation |
| `refreshTokenStore` | `RefreshTokenStore` | No | -- | Enables refresh token rotation with reuse detection |
| `passwordReset` | `{ storage, passwordStorage, tokenExpiry? }` | No | -- | Enables password reset flow |
| `emailVerification` | `{ storage, tokenExpiry? }` | No | -- | Enables email verification flow |

### TokenConfig

| Field | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `secret` | `string` | Yes | -- | HMAC secret used to sign and verify tokens |
| `accessTokenExpiry` | `string` | No | `"15m"` | Access token expiry (e.g., `"15m"`, `"1h"`) |
| `refreshTokenExpiry` | `string` | No | `"7d"` | Refresh token expiry (e.g., `"7d"`, `"30d"`) |
| `issuer` | `string` | No | `"forja"` | Token issuer claim |

## Service API

### `register(input)`

Creates a new user, hashes the password, generates a token pair, and optionally creates a verification token.

- **Params:** `{ email, password, name, role?, tenantId }`
- **Returns:** `Promise<{ user, accessToken, refreshToken, verificationToken? }>`
- **Throws:**
  - `EMAIL_EXISTS` (409) if the email is already registered in the tenant.
  - `ZodError` if the input fails validation.

```ts
const result = await service.register({
  email: "user@example.com",
  password: "Str0ng!Pass",
  name: "Jane Doe",
  role: "client", // optional, defaults to defaultRole
  tenantId: "tenant-1",
});
// result.user, result.accessToken, result.refreshToken, result.verificationToken?
```

### `login(input)`

Authenticates a user by email and password, returns a token pair.

- **Params:** `{ email, password, tenantId }`
- **Returns:** `Promise<{ user, accessToken, refreshToken }>`
- **Throws:** `INVALID_CREDENTIALS` (401) if the email does not exist or the password is wrong. The error message is generic to avoid leaking whether the email exists.

```ts
const result = await service.login({
  email: "user@example.com",
  password: "Str0ng!Pass",
  tenantId: "tenant-1",
});
```

### `refresh(refreshToken)`

Exchanges a refresh token for a new token pair. If `refreshTokenStore` is configured, performs token rotation with reuse detection.

- **Params:** `refreshToken: string`
- **Returns:** `Promise<{ accessToken, refreshToken }>`
- **Throws:**
  - `INVALID_TOKEN` (401) if the token is invalid or expired.
  - `REFRESH_TOKEN_REUSE` (401) if a revoked token is reused (breach detection -- revokes the entire family).
  - `USER_NOT_FOUND` (404) if the user no longer exists.

**Rotation flow (when `refreshTokenStore` is configured):**

1. Verify the JWT signature, issuer, audience, and expiration.
2. Look up the token hash in the store.
3. If the token was already revoked, revoke the entire family (breach detection) and reject.
4. Revoke the current token.
5. Generate a new token pair and store the new refresh token in the same family.

**Stateless flow (without `refreshTokenStore`):**

1. Verify the JWT.
2. Look up the user.
3. Generate a new token pair.

### `authenticate(accessToken)`

Verifies an access token and returns the authenticated user.

- **Params:** `accessToken: string`
- **Returns:** `Promise<{ id, email, name, role, tenantId }>`
- **Throws:**
  - `INVALID_TOKEN` (401) if the token is invalid or expired.
  - `TOKEN_REVOKED` (401) if the token has been blacklisted (requires `tokenBlacklist`).
  - `USER_NOT_FOUND` (404) if the user no longer exists.

### `authorize(...allowedRoles)`

Returns a function that checks if a user has one of the allowed roles. This is a synchronous guard, not an async method.

- **Params:** `...allowedRoles: Role[]`
- **Returns:** `(user) => void`
- **Throws:** `FORBIDDEN` (403) if the user's role is not in the allowed list.

```ts
const requireAdmin = service.authorize("admin");
const user = await service.authenticate(token);
requireAdmin(user); // throws if not admin
```

### `logout(accessToken)`

Blacklists the access token's JTI so it cannot be used again. Requires `tokenBlacklist` to be configured.

- **Params:** `accessToken: string`
- **Returns:** `Promise<void>`
- **Throws:**
  - `FEATURE_NOT_CONFIGURED` (500) if `tokenBlacklist` is not provided.
  - `INVALID_TOKEN` (401) if the token is invalid.

### `requestPasswordReset(email, tenantId)`

Generates an opaque reset token, hashes it, and stores it. Returns the raw token (for sending via email) or `null` if the user does not exist. The `null` return avoids leaking whether the email is registered.

- **Params:** `email: string`, `tenantId: string`
- **Returns:** `Promise<string | null>`
- **Throws:** `FEATURE_NOT_CONFIGURED` (500) if `passwordReset` is not configured.

### `resetPassword(token, newPassword, tenantId)`

Validates the reset token, hashes the new password, and updates the user's password.

- **Params:** `token: string`, `newPassword: string`, `tenantId: string`
- **Returns:** `Promise<void>`
- **Throws:**
  - `FEATURE_NOT_CONFIGURED` (500) if `passwordReset` is not configured.
  - `RESET_TOKEN_INVALID` (400) if the token does not exist.
  - `RESET_TOKEN_USED` (400) if the token was already used.
  - `RESET_TOKEN_EXPIRED` (400) if the token has expired.
  - `ZodError` if the new password does not meet strength requirements.

### `verifyEmail(token)`

Validates a verification token and marks the user's email as verified.

- **Params:** `token: string`
- **Returns:** `Promise<void>`
- **Throws:**
  - `FEATURE_NOT_CONFIGURED` (500) if `emailVerification` is not configured.
  - `VERIFICATION_TOKEN_INVALID` (400) if the token does not exist.
  - `VERIFICATION_TOKEN_USED` (400) if the email was already verified.
  - `VERIFICATION_TOKEN_EXPIRED` (400) if the token has expired.

### `resendVerificationEmail(email, tenantId)`

Generates a new verification token. Returns the raw token or `null` if the user does not exist.

- **Params:** `email: string`, `tenantId: string`
- **Returns:** `Promise<string | null>`
- **Throws:** `FEATURE_NOT_CONFIGURED` (500) if `emailVerification` is not configured.

### `schemas`

The service exposes the composed Zod schemas via `service.schemas` for external use (e.g., route validation). See the Schema Factory section below.

## Schema Factory

`createAuthSchemas()` produces Zod schemas composed with your role enum. The service creates these internally, but you can also use them standalone.

```ts
import { createAuthSchemas } from "@forjakit/auth";
import { z } from "zod";

const roles = z.enum(["admin", "client"]);
const schemas = createAuthSchemas(roles, "client");
```

### Produced Schemas

| Schema | Description |
| ------ | ----------- |
| `RegisterInput` | `{ email, password, name, role?, tenantId }` with email normalization and password strength validation |
| `LoginInput` | `{ email, password, tenantId }` with email normalization |
| `RefreshInput` | `{ refreshToken }` |
| `TokenPayload` | `{ sub, email, name, role, tenantId }` |
| `AuthUser` | `{ id, email, name, role, tenantId }` |
| `RequestPasswordResetInput` | `{ email, tenantId }` with email normalization |
| `ResetPasswordInput` | `{ token, password, tenantId }` with password strength validation |
| `VerifyEmailInput` | `{ token }` |

### Email Normalization

All email inputs are trimmed and lowercased before validation: `" User@Example.COM "` becomes `"user@example.com"`.

### Password Validation Rules

The `strongPassword` schema enforces:

- Minimum 8 characters
- At least one uppercase letter
- At least one number
- At least one special character

Applied to `RegisterInput.password` and `ResetPasswordInput.password`.

## Password Hashing

Passwords are hashed using argon2. The `hashPassword` and `verifyPassword` functions are exported for standalone use.

```ts
import { hashPassword, verifyPassword } from "@forjakit/auth";

const hash = await hashPassword("Str0ng!Pass");
const valid = await verifyPassword(hash, "Str0ng!Pass"); // true
```

## Opaque Token Utilities

For password reset and email verification, the service uses opaque tokens (random hex strings) that are SHA-256 hashed before storage. Only the hash is persisted; the raw token is sent to the user.

```ts
import { generateOpaqueToken, hashToken } from "@forjakit/auth";

const raw = generateOpaqueToken();    // 64-char hex string (32 random bytes)
const hashed = hashToken(raw);        // SHA-256 hex digest
```

## Error Handling

All business errors are thrown as `AuthError` instances with a machine-readable `code` and an HTTP-friendly `statusCode`.

```ts
import { AuthError } from "@forjakit/auth";

try {
  await service.login({ email: "user@example.com", password: "wrong", tenantId: "t1" });
} catch (err) {
  if (err instanceof AuthError) {
    console.log(err.code);       // "INVALID_CREDENTIALS"
    console.log(err.statusCode); // 401
    console.log(err.message);    // "Invalid email or password"
  }
}
```

### Error Codes

| Code | HTTP Status | Thrown When |
| ---- | ----------- | ---------- |
| `EMAIL_EXISTS` | 409 | Registering with an email already in use (within the tenant) |
| `INVALID_CREDENTIALS` | 401 | Login with wrong email or password |
| `INVALID_TOKEN` | 401 | Token is invalid, expired, or has the wrong audience |
| `USER_NOT_FOUND` | 404 | User referenced by a token no longer exists |
| `FORBIDDEN` | 403 | User's role is not in the allowed list |
| `TOKEN_REVOKED` | 401 | Access token has been blacklisted via logout |
| `REFRESH_TOKEN_REUSE` | 401 | A revoked refresh token was reused (breach detected) |
| `FEATURE_NOT_CONFIGURED` | 500 | Using a feature without providing its config |
| `RESET_TOKEN_INVALID` | 400 | Password reset token does not exist |
| `RESET_TOKEN_USED` | 400 | Password reset token was already used |
| `RESET_TOKEN_EXPIRED` | 400 | Password reset token has expired |
| `VERIFICATION_TOKEN_INVALID` | 400 | Email verification token does not exist |
| `VERIFICATION_TOKEN_USED` | 400 | Email was already verified |
| `VERIFICATION_TOKEN_EXPIRED` | 400 | Email verification token has expired |
| `RATE_LIMITED` | 429 | Too many requests (used by the Fastify adapter) |

### Error Factories

The `Errors` object provides factory functions for creating errors programmatically:

```ts
import { Errors } from "@forjakit/auth";

Errors.emailAlreadyExists();
Errors.invalidCredentials();
Errors.invalidToken();
Errors.userNotFound();
Errors.forbidden();
Errors.tokenRevoked();
Errors.refreshTokenReuse();
Errors.featureNotConfigured("Logout");
Errors.resetTokenExpired();
Errors.resetTokenUsed();
Errors.resetTokenInvalid();
Errors.verificationTokenExpired();
Errors.verificationTokenUsed();
Errors.verificationTokenInvalid();
Errors.rateLimited(60);
```

## Storage Interfaces

### AuthStorage (required)

The only required storage interface. Handles user persistence.

```ts
interface AuthStorage {
  findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null>;
  createUser(input: CreateUserInput): Promise<PublicUser>;
  findUserById(id: string, tenantId: string): Promise<PublicUser | null>;
}
```

### TokenBlacklist (opt-in, enables logout)

```ts
interface TokenBlacklist {
  add(jti: string, expiresAt: Date): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean>;
}
```

### RefreshTokenStore (opt-in, enables rotation + breach detection)

```ts
interface RefreshTokenStore {
  store(input: {
    tokenHash: string;
    userId: string;
    tenantId: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<void>;
  find(tokenHash: string): Promise<{
    userId: string;
    tenantId: string;
    familyId: string;
    revoked: boolean;
    expiresAt: Date;
  } | null>;
  revoke(tokenHash: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
}
```

### PasswordResetStorage (opt-in, enables password reset)

```ts
interface PasswordResetStorage {
  createResetToken(input: {
    tokenHash: string;
    userId: string;
    tenantId: string;
    expiresAt: Date;
  }): Promise<void>;
  findResetToken(tokenHash: string): Promise<{
    userId: string;
    tenantId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null>;
  markResetTokenUsed(tokenHash: string): Promise<void>;
}
```

### PasswordUpdateStorage (opt-in, used with password reset)

```ts
interface PasswordUpdateStorage {
  updatePassword(userId: string, tenantId: string, passwordHash: string): Promise<void>;
}
```

### EmailVerificationStorage (opt-in, enables email verification)

```ts
interface EmailVerificationStorage {
  createVerificationToken(input: {
    tokenHash: string;
    userId: string;
    tenantId: string;
    expiresAt: Date;
  }): Promise<void>;
  findVerificationToken(tokenHash: string): Promise<{
    userId: string;
    tenantId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null>;
  markVerificationTokenUsed(tokenHash: string): Promise<void>;
  markEmailVerified(userId: string, tenantId: string): Promise<void>;
}
```

### RateLimiter (opt-in, used by the Fastify adapter)

```ts
interface RateLimiter {
  consume(key: string, action: string): Promise<RateLimitResult>;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // seconds
}
```

## Security Features

- **Argon2 password hashing** -- industry-standard memory-hard algorithm.
- **Separate JWT audiences** -- access tokens (`forja:access`) and refresh tokens (`forja:refresh`) cannot be used interchangeably.
- **Token blacklisting** -- revoke access tokens on logout.
- **Refresh token rotation** -- each refresh issues a new token pair. Old tokens are revoked.
- **Breach detection** -- if a revoked refresh token is reused, the entire token family is revoked.
- **Opaque token hashing** -- password reset and email verification tokens are SHA-256 hashed before storage. The raw token is never persisted.
- **Email normalization** -- emails are trimmed and lowercased to prevent duplicates.
- **Generic error messages** -- login failures do not reveal whether the email exists.
- **Password strength enforcement** -- minimum 8 characters, uppercase, number, special character.
- **Tenant isolation** -- all operations are scoped to a tenant ID.

## Full Working Example

```ts
import { createAuthService, type AuthStorage, type TokenBlacklist } from "@forjakit/auth";
import { z } from "zod";

// 1. Define your roles
const roles = z.enum(["admin", "professional", "client"]);

// 2. Implement storage (or use @forjakit/auth-prisma)
const storage: AuthStorage = {
  // ... your implementation
};
const tokenBlacklist: TokenBlacklist = {
  // ... your implementation
};

// 3. Create the service
const auth = createAuthService({
  storage,
  tokens: { secret: "my-jwt-secret" },
  roles,
  defaultRole: "client",
  tokenBlacklist,
});

// 4. Register a user
const { user, accessToken, refreshToken } = await auth.register({
  email: "jane@example.com",
  password: "Str0ng!Pass",
  name: "Jane Doe",
  tenantId: "tenant-1",
});

// 5. Authenticate a request
const authedUser = await auth.authenticate(accessToken);

// 6. Authorize by role
const requireAdmin = auth.authorize("admin");
try {
  requireAdmin(authedUser); // throws FORBIDDEN if not admin
} catch (err) {
  console.log("Not an admin");
}

// 7. Refresh tokens
const newTokens = await auth.refresh(refreshToken);

// 8. Logout
await auth.logout(accessToken);
```

## Exports

```ts
// Service
export { createAuthService } from "@forjakit/auth";
export type { AuthService, AuthServiceConfig } from "@forjakit/auth";

// Schemas
export { createAuthSchemas } from "@forjakit/auth";
export type { AuthSchemas } from "@forjakit/auth";

// Password
export { hashPassword, verifyPassword } from "@forjakit/auth";

// Crypto
export { generateOpaqueToken, hashToken } from "@forjakit/auth";

// Tokens
export {
  generateAccessToken, generateRefreshToken, generateTokenPair,
  verifyAccessToken, verifyRefreshToken, TOKEN_AUDIENCE,
} from "@forjakit/auth";
export type { TokenConfig, TokenPayload } from "@forjakit/auth";

// Errors
export { AuthError, Errors } from "@forjakit/auth";

// Types
export type {
  AuthStorage, StoredUser, CreateUserInput, PublicUser,
  TokenBlacklist, RefreshTokenStore,
  PasswordResetStorage, PasswordUpdateStorage, EmailVerificationStorage,
  RateLimiter, RateLimitResult,
} from "@forjakit/auth";
```

# @forja/auth-fastify

Fastify plugin that exposes `@forja/auth` as a REST API. Registers auth routes with tenant isolation, input validation, rate limiting, optional cookie-based token delivery, and structured error responses. Also provides standalone middleware factories for protecting routes in other plugins.

## Installation

```bash
pnpm add @forja/auth-fastify
```

Peer dependencies: `@forja/auth`, `fastify >= 5`, `zod >= 3.24`.

## Plugin Registration

```ts
import Fastify from "fastify";
import { authPlugin } from "@forja/auth-fastify";
import { createAuthService } from "@forja/auth";

const app = Fastify();

const service = createAuthService({
  storage: myStorage,
  tokens: { secret: process.env.JWT_SECRET! },
  roles: myRoles,
  defaultRole: "client",
});

app.register(authPlugin, {
  service,
  prefix: "/auth",
  tenantResolver: (req) => req.headers["x-tenant-id"] as string,
  rateLimiter: myRateLimiter,
  onPasswordResetToken: async (token, { email, tenantId }) => {
    await sendResetEmail(email, token);
  },
  onVerificationToken: async (token, { email, tenantId }) => {
    await sendVerificationEmail(email, token);
  },
});
```

### AuthPluginOptions

| Option | Type | Required | Default | Description |
| ------ | ---- | -------- | ------- | ----------- |
| `service` | `AuthService` | Yes | -- | Service instance from `createAuthService` |
| `prefix` | `string` | No | `""` | Route prefix (e.g., `"/auth"`) |
| `tenantResolver` | `(req: FastifyRequest) => string` | No | `x-tenant-id` header or subdomain | Extracts tenant ID from the request |
| `rateLimiter` | `RateLimiter` | No | None | Applied to register, login, and password reset routes |
| `rateLimitKeyResolver` | `(req: FastifyRequest) => string` | No | `req.ip` | Extracts the rate limit key from a request |
| `onPasswordResetToken` | `(token, { email, tenantId }) => Promise<void>` | No | -- | Callback to send the reset email |
| `onVerificationToken` | `(token, { email, tenantId }) => Promise<void>` | No | -- | Callback to send the verification email |
| `cookie` | `AuthCookieOptions` | No | Disabled | Cookie-based token delivery configuration |

## Routes

All routes are relative to the configured `prefix`. Tenant ID is resolved from every request via `tenantResolver`.

| Method | Path | Rate Limited | Description |
| ------ | ---- | ------------ | ----------- |
| `POST` | `/register` | Yes | Register a new user |
| `POST` | `/login` | Yes | Login with email and password |
| `POST` | `/refresh` | No | Exchange refresh token for new token pair |
| `GET` | `/me` | No | Get the authenticated user |
| `POST` | `/logout` | No | Blacklist the access token |
| `POST` | `/request-password-reset` | Yes | Request a password reset token |
| `POST` | `/reset-password` | No | Reset password with token |
| `POST` | `/verify-email` | No | Verify email with token |
| `POST` | `/resend-verification` | No | Resend verification email |

### POST /register

Creates a new user and returns tokens.

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "Str0ng!Pass",
  "name": "Jane Doe",
  "role": "client"
}
```

Note: `tenantId` is injected by the plugin from `tenantResolver`, not from the request body. `role` is optional and defaults to the configured `defaultRole`.

**Response:** `201 Created`

```json
{
  "user": { "id": "...", "email": "user@example.com", "name": "Jane Doe", "role": "client", "tenantId": "..." },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

If email verification is enabled and `onVerificationToken` is provided, the callback is invoked with the raw verification token. The `verificationToken` is not included in the response.

### POST /login

Authenticates a user.

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "Str0ng!Pass"
}
```

**Response:** `200 OK`

```json
{
  "user": { "id": "...", "email": "...", "name": "...", "role": "...", "tenantId": "..." },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

### POST /refresh

Exchanges a refresh token for a new token pair.

**Request body:**

```json
{
  "refreshToken": "eyJ..."
}
```

**Response:** `200 OK`

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

In cookie mode, the refresh token is read from the cookie. The response body contains `{ "message": "Tokens refreshed" }` instead of the tokens.

### GET /me

Returns the authenticated user. Requires a valid access token in the `Authorization: Bearer <token>` header or access token cookie.

**Response:** `200 OK`

```json
{
  "id": "...",
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "client",
  "tenantId": "..."
}
```

### POST /logout

Blacklists the access token. Requires `tokenBlacklist` to be configured on the auth service.

**Response:** `204 No Content`

In cookie mode, token cookies are cleared.

### POST /request-password-reset

Generates a reset token and invokes `onPasswordResetToken` if the user exists. Always returns the same response to avoid leaking whether the email is registered.

**Request body:**

```json
{
  "email": "user@example.com"
}
```

**Response:** `200 OK`

```json
{
  "message": "If the email exists, a reset link has been sent"
}
```

### POST /reset-password

Validates the reset token and updates the password.

**Request body:**

```json
{
  "token": "abc123...",
  "password": "NewStr0ng!Pass"
}
```

**Response:** `200 OK`

```json
{
  "message": "Password has been reset"
}
```

### POST /verify-email

Validates the verification token and marks the email as verified.

**Request body:**

```json
{
  "token": "abc123..."
}
```

**Response:** `200 OK`

```json
{
  "message": "Email verified"
}
```

### POST /resend-verification

Generates a new verification token and invokes `onVerificationToken` if the user exists.

**Request body:**

```json
{
  "email": "user@example.com"
}
```

**Response:** `200 OK`

```json
{
  "message": "If the email exists, a verification link has been sent"
}
```

## Cookie-Based Token Delivery

When enabled, tokens are delivered as `HttpOnly` cookies instead of in the response body. The plugin automatically registers `@fastify/cookie`.

```ts
app.register(authPlugin, {
  service,
  cookie: {
    enabled: true,
    secure: true,           // default: true in production
    sameSite: "lax",        // default: "lax"
    domain: ".example.com", // default: request hostname
    path: "/",              // default: "/"
    accessTokenName: "access_token",   // default: "access_token"
    refreshTokenName: "refresh_token", // default: "refresh_token"
  },
});
```

### AuthCookieOptions

| Option | Type | Required | Default | Description |
| ------ | ---- | -------- | ------- | ----------- |
| `enabled` | `boolean` | Yes | -- | Enable cookie-based token delivery |
| `secure` | `boolean` | No | `true` in production | Set the `Secure` flag (HTTPS only) |
| `sameSite` | `"strict" \| "lax" \| "none"` | No | `"lax"` | SameSite attribute |
| `domain` | `string` | No | Request hostname | Cookie domain |
| `path` | `string` | No | `"/"` | Cookie path |
| `accessTokenName` | `string` | No | `"access_token"` | Cookie name for the access token |
| `refreshTokenName` | `string` | No | `"refresh_token"` | Cookie name for the refresh token |

**How it works:**

- On **login/register**, tokens are set as `HttpOnly` cookies. The response body contains the user data but not the tokens.
- On **refresh**, the refresh token is read from the cookie. New tokens are set as cookies. The response body contains `{ "message": "Tokens refreshed" }`.
- On **logout** and **401 errors**, token cookies are cleared (set to empty with `maxAge: 0`).
- **Token extraction** always checks cookies first, then falls back to the `Authorization: Bearer` header.

Cookie max ages: access token = 15 minutes, refresh token = 7 days.

## Middleware

Standalone middleware factories for protecting routes in other plugins.

### `authenticate(service, cookieAccessTokenName?)`

Fastify preHandler that authenticates the request via Bearer token or cookie and populates `request.authUser`.

```ts
import { authenticate } from "@forja/auth-fastify";

app.get("/protected", { preHandler: authenticate(service) }, async (req) => {
  const user = req.authUser;
  return { message: `Hello ${user.name}` };
});
```

### `requireRole(service, ...roles)`

Fastify preHandler that authenticates and checks if the user has one of the required roles.

```ts
import { requireRole } from "@forja/auth-fastify";

app.delete("/admin-only", { preHandler: requireRole(service, "admin") }, async (req) => {
  return { message: "Admin action performed" };
});
```

### `createCookieMiddleware(service, accessTokenName)`

Creates middleware factories pre-configured with cookie support. Use this when cookie mode is enabled to avoid passing the cookie name to every middleware call.

```ts
import { createCookieMiddleware } from "@forja/auth-fastify";

const { authenticate, requireRole } = createCookieMiddleware(service, "access_token");

app.get("/profile", { preHandler: authenticate() }, handler);
app.delete("/admin", { preHandler: requireRole("admin") }, handler);
```

### request.authUser

All middleware populates `request.authUser` with the authenticated user object:

```ts
interface FastifyRequest {
  authUser?: {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
  };
}
```

## Tenant Resolution

By default, the plugin resolves the tenant ID using this strategy:

1. Read the `x-tenant-id` header.
2. Fall back to the first subdomain of the request hostname (e.g., `acme.example.com` -> `"acme"`).
3. Throw `AuthError` with code `TENANT_REQUIRED` (400) if neither is available.

Provide a custom resolver to extract the tenant ID from any source:

```ts
app.register(authPlugin, {
  service,
  tenantResolver: (req) => {
    // From JWT claims, database lookup, etc.
    return (req as any).user.tenantId;
  },
});
```

## Rate Limiting

The plugin accepts a `RateLimiter` interface (defined in `@forja/auth`). Rate limiting is applied to `register`, `login`, and `request-password-reset` routes.

```ts
app.register(authPlugin, {
  service,
  rateLimiter: myRedisRateLimiter,
  rateLimitKeyResolver: (req) => req.ip, // default
});
```

When rate limited, the response includes a `Retry-After` header and returns:

```json
{
  "error": "RATE_LIMITED",
  "message": "Too many requests, retry after 60 seconds"
}
```

HTTP status: `429`.

## Error Handling

The plugin registers a scoped Fastify error handler that converts known errors into structured JSON responses.

### AuthError Response

```json
{
  "error": "INVALID_CREDENTIALS",
  "message": "Invalid email or password"
}
```

HTTP status codes are taken directly from the `AuthError.statusCode` property. See the core package documentation for the full error code table.

### ZodError Response (Validation Failures)

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid input",
  "details": [
    { "field": "password", "message": "Password must be at least 8 characters" },
    { "field": "email", "message": "Invalid email" }
  ]
}
```

HTTP status: `400`.

### Unhandled Errors

Any error that is not an `AuthError` or `ZodError` is re-thrown to Fastify's default error handler.

## Email Callbacks

The plugin does not send emails. Instead, it invokes optional callbacks with the raw token and user info. You provide the email delivery logic.

```ts
app.register(authPlugin, {
  service,
  onPasswordResetToken: async (token, { email, tenantId }) => {
    const resetUrl = `https://app.example.com/reset-password?token=${token}`;
    await emailService.send(email, "Reset your password", resetUrl);
  },
  onVerificationToken: async (token, { email, tenantId }) => {
    const verifyUrl = `https://app.example.com/verify-email?token=${token}`;
    await emailService.send(email, "Verify your email", verifyUrl);
  },
});
```

## Full Integration Example

```ts
import Fastify from "fastify";
import { createAuthService } from "@forja/auth";
import {
  createPrismaAuthStorage,
  createPrismaTokenBlacklist,
  createPrismaRefreshTokenStore,
  createPrismaPasswordResetStorage,
  createPrismaPasswordUpdateStorage,
  createPrismaEmailVerificationStorage,
} from "@forja/auth-prisma";
import { authPlugin, authenticate, requireRole } from "@forja/auth-fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

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
    storage: createPrismaEmailVerificationStorage(prisma.emailVerificationToken, prisma.user),
  },
});

app.register(authPlugin, {
  service,
  prefix: "/auth",
  cookie: { enabled: true, secure: true },
  onPasswordResetToken: async (token, { email }) => {
    await sendResetEmail(email, token);
  },
  onVerificationToken: async (token, { email }) => {
    await sendVerificationEmail(email, token);
  },
});

// Protect other routes
app.get("/api/profile", { preHandler: authenticate(service) }, async (req) => {
  return req.authUser;
});

app.delete("/api/admin/users/:id", { preHandler: requireRole(service, "admin") }, async (req) => {
  // admin-only logic
});

app.listen({ port: 3000 });
```

With this setup, the following routes are available:

```
POST /auth/register
POST /auth/login
POST /auth/refresh
GET  /auth/me
POST /auth/logout
POST /auth/request-password-reset
POST /auth/reset-password
POST /auth/verify-email
POST /auth/resend-verification
```

## Exports

```ts
export { authPlugin } from "@forja/auth-fastify";
export type { AuthPluginOptions, AuthCookieOptions } from "@forja/auth-fastify";
export { authenticate, requireRole, createCookieMiddleware } from "@forja/auth-fastify";
```

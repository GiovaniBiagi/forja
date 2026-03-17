# Forja

Modular business toolkit for building applications faster. "Forja" means "forge" in Portuguese -- the idea is to forge production-ready features from well-tested, reusable building blocks.

All packages live under the `@forjakit/*` npm scope.

## Philosophy

- **Framework-agnostic cores.** Business logic packages have zero framework or database dependencies. Pure functions, interfaces, and Zod schemas.
- **Adapter pattern.** Framework integrations (Fastify, Express, etc.) and storage implementations (Prisma, Drizzle, etc.) live in separate packages that depend on the core.
- **Storage interfaces.** Database access is abstracted behind interfaces. Consumers provide their own implementation or use a ready-made adapter.
- **Zod extensibility.** Consumers extend base schemas with custom fields (metadata, roles, etc.) via Zod schema composition. Generics flow through the entire system.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Your Application                    │
├──────────────────────┬──────────────────────────────┤
│   @forjakit/auth-fastify│  @forjakit/scheduling-fastify   │  ← HTTP adapters
├──────────────────────┼──────────────────────────────┤
│   @forjakit/auth        │  @forjakit/scheduling           │  ← Framework-agnostic cores
├──────────────────────┼──────────────────────────────┤
│   @forjakit/auth-prisma │  @forjakit/scheduling-prisma    │  ← Storage adapters
├──────────────────────┴──────────────────────────────┤
│                    Database                           │
└─────────────────────────────────────────────────────┘
```

Cores define business logic and storage interfaces. HTTP adapters expose REST routes. Storage adapters implement persistence. Your application wires them together.

## Packages

| Package | Description | Version |
| ------- | ----------- | ------- |
| [`@forjakit/auth`](./packages/auth) | Framework-agnostic auth service: registration, login, JWT tokens, roles, password reset, email verification | `0.1.0` |
| [`@forjakit/auth-fastify`](./packages/auth-fastify) | Fastify plugin for `@forjakit/auth`: routes, middleware, cookie support, rate limiting | `0.1.0` |
| [`@forjakit/auth-prisma`](./packages/auth-prisma) | Prisma storage adapters for `@forjakit/auth` | `0.1.0` |
| [`@forjakit/scheduling`](./packages/scheduling) | Framework-agnostic scheduling engine: events, conflict detection, availability slots | `0.1.0` |
| [`@forjakit/scheduling-fastify`](./packages/scheduling-fastify) | Fastify plugin for `@forjakit/scheduling`: CRUD routes, guards, tenant resolution | `0.1.0` |
| [`@forjakit/scheduling-prisma`](./packages/scheduling-prisma) | Prisma storage adapters for `@forjakit/scheduling` | `0.1.0` |

## Quick Start

A minimal example wiring auth and scheduling together with Fastify and Prisma:

```ts
import Fastify from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

// Auth
import { createAuthService } from "@forjakit/auth";
import { authPlugin, authenticate } from "@forjakit/auth-fastify";
import {
  createPrismaAuthStorage,
  createPrismaTokenBlacklist,
  createPrismaRefreshTokenStore,
} from "@forjakit/auth-prisma";

// Scheduling
import { createSchedulingService } from "@forjakit/scheduling";
import { schedulingPlugin } from "@forjakit/scheduling-fastify";
import { createPrismaSchedulingStorage } from "@forjakit/scheduling-prisma";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

// -- Auth setup --
const roles = z.enum(["admin", "professional", "client"]);

const authService = createAuthService({
  storage: createPrismaAuthStorage(prisma.user),
  tokens: { secret: process.env.JWT_SECRET! },
  roles,
  defaultRole: "client",
  tokenBlacklist: createPrismaTokenBlacklist(prisma.tokenBlacklist),
  refreshTokenStore: createPrismaRefreshTokenStore(prisma.refreshToken),
});

app.register(authPlugin, {
  service: authService,
  prefix: "/auth",
});

// -- Scheduling setup --
const matchMetadata = z.object({
  round: z.number().int().positive(),
  group: z.string().optional(),
});

const schedulingService = createSchedulingService({
  storage: createPrismaSchedulingStorage(prisma.scheduledEvent),
  metadataSchema: matchMetadata,
});

app.register(schedulingPlugin, {
  service: schedulingService,
  prefix: "/scheduling",
  guards: {
    write: authenticate(authService),
  },
});

app.listen({ port: 3000 });
```

## Monorepo Structure

```
forja/
├── packages/
│   ├── auth/                 # @forjakit/auth
│   ├── auth-fastify/         # @forjakit/auth-fastify
│   ├── auth-prisma/          # @forjakit/auth-prisma
│   ├── scheduling/           # @forjakit/scheduling
│   ├── scheduling-fastify/   # @forjakit/scheduling-fastify
│   └── scheduling-prisma/    # @forjakit/scheduling-prisma
├── apps/                     # Consumer applications
├── package.json
├── pnpm-workspace.yaml
└── CLAUDE.md                 # Project guidelines
```

## Tech Stack

- **TypeScript** -- strict mode, no `any`
- **Zod** -- input validation and schema composition
- **Vitest** -- test runner (TDD workflow)
- **tsup** -- build tool
- **pnpm workspaces** -- monorepo management
- **Husky + commitlint** -- conventional commits

## Development

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Build all packages
pnpm build
```

Node.js >= 18 required.

## Contributing

See [CLAUDE.md](./CLAUDE.md) for project guidelines including:

- Conventional commit format
- Code quality standards
- Security practices
- TDD workflow
- Package architecture rules

## License

MIT

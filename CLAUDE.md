# Forja — Project Guidelines

## Conventional Commits

All commits MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
**Scopes:** package name without `@forja/` prefix (e.g., `auth`, `auth-fastify`, `scheduling`) or `repo` for root-level changes.

Examples:
- `feat(auth): add password reset flow`
- `fix(auth-fastify): handle missing tenant header gracefully`
- `test(auth): add edge cases for token expiration`
- `chore(repo): update dependencies`

Breaking changes must include `BREAKING CHANGE:` in the footer or `!` after the type/scope.

## Code Quality

- **Clear naming:** variables, functions, and types must be self-explanatory. Avoid abbreviations unless universally understood (e.g., `id`, `url`).
- **Small functions:** each function should do one thing. If a function needs a comment to explain *what* it does, it should be renamed or split.
- **Comments:** only when explaining *why*, never *what*. The code should explain itself.
- **Types:** use strict TypeScript. Avoid `any` — use `unknown` when the type is genuinely unknown. Export types that consumers need.
- **Exports:** each package has a single `index.ts` barrel file. Only export what is part of the public API.
- **No dead code:** don't commit commented-out code, unused imports, or unused variables.
- **JSDoc:** add JSDoc to all public API functions and types with a brief description, `@param`, and `@returns`. Internal/private functions don't need JSDoc.

## Security

- **Never log or expose secrets** (passwords, tokens, keys) in error messages, responses, or console output.
- **Validate all external input** at system boundaries using Zod schemas. Trust internal code.
- **Password hashing:** always use argon2. Never store plaintext passwords.
- **JWT:** use separate audience claims for access vs refresh tokens. Verify issuer, audience, and expiration on every token check.
- **Email normalization:** always trim and lowercase emails before storage or comparison.
- **Error messages:** auth errors must not reveal whether an email exists (use generic "Invalid email or password").
- **Dependencies:** keep dependencies minimal. Audit before adding new ones.

## Test-Driven Development (TDD)

- **Write tests first** when adding new features or fixing bugs:
  1. Write a failing test that describes the expected behavior
  2. Write the minimum code to make it pass
  3. Refactor while keeping tests green
- **Test file location:** colocated with source files as `<name>.test.ts`
- **Test structure:** use `describe` blocks for grouping, `it` blocks with clear descriptions of expected behavior
- **What to test:**
  - All public API functions
  - Edge cases and error paths
  - Schema validations (valid + invalid inputs)
  - Security-sensitive logic (auth, tokens, permissions)
- **What NOT to test:**
  - Internal implementation details
  - Third-party library behavior
- **Run tests before committing.** All tests must pass.
- **Test runner:** vitest (`pnpm test`)

## Package Architecture

- **Framework-agnostic core:** business logic packages (e.g., `@forja/auth`) must have zero framework dependencies. Pure functions and interfaces only.
- **Adapter pattern:** framework integrations live in separate packages (e.g., `@forja/auth-fastify`) that depend on the core.
- **Storage interface:** database access is abstracted behind interfaces. Consumers provide their own implementation.
- **Extensibility:** use Zod schema composition to allow consumers to extend base schemas with custom fields.

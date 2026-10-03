# ADR-011: Toolchain pins

Status: Accepted
Date: 2026-10-03

## Decision

- **NestJS 11** (CommonJS) instead of NestJS 12. NestJS 12 ships ESM-only,
  which Jest's CommonJS runtime cannot load on Node 22 without experimental
  flags. NestJS 11 is maintained and fully featured.
- **TypeScript 5.9** instead of 7.x (native compiler): typescript-eslint and
  other tooling support `<6.1`.
- **Go 1.26** (required by current staticcheck/golang-migrate releases).
- **Node 22 LTS**, **pnpm 10** (installed via npm in images; corepack is not
  bundled with newer Node versions).

## Consequences / migration plan

Upgrading to NestJS 12 requires converting `apps/control-api` to ESM and
moving its tests to an ESM-capable runner (Vitest + SWC) — tracked in
PROJECT_STATUS.md technical debt. No API contract changes are involved.

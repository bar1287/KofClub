# @kofclub/contracts

Canonical, versioned contracts shared by every client and service.

| File                       | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `openapi/control-api.yaml` | Control API HTTP contract (canonical; spec §7) |
| `openapi/realtime.yaml`    | WebSocket message schemas (spec §8)            |
| `src/generated/*.ts`       | Generated TypeScript types — **do not edit**   |
| `go/*/types.gen.go`        | Generated Go types — **do not edit**           |

Regenerate everything from the repository root with `make contracts`.
CI runs `make contracts-check`, which fails if regeneration produces a diff.

Rules: never hand-edit generated files; change the YAML and regenerate.
Breaking changes require a new API version (`/v2`) or an ADR.

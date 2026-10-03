# @kofclub/config

Shared TypeScript compiler presets. Workspaces extend one of:

- `tsconfig.base.json` — strict defaults for every TS package.
- `tsconfig.node.json` — ESM Node services/packages (NodeNext resolution).
- `tsconfig.nest.json` — NestJS (CommonJS + decorator metadata).

Linting/formatting config lives at the repository root (`eslint.config.mjs`, `.prettierrc.json`).

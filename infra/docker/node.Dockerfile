# syntax=docker/dockerfile:1.7
# Builds the TypeScript deployables from the pnpm workspace. Select one with
# --target (control-api | worker | web).
FROM node:22-alpine AS base
ENV CI=true
# Install the pinned pnpm with npm (corepack is not bundled with newer Node releases).
RUN npm install -g pnpm@10.28.0 && pnpm config set store-dir /pnpm/store
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/control-api/package.json apps/control-api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
COPY packages/test-fixtures/package.json packages/test-fixtures/
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_REALTIME_URL=ws://localhost:4100/ws
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build:packages \
 && pnpm --filter @kofclub/control-api --filter @kofclub/worker --filter @kofclub/web build \
 && pnpm --filter @kofclub/control-api deploy --prod --legacy /out/control-api \
 && pnpm --filter @kofclub/worker deploy --prod --legacy /out/worker

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
USER app

FROM runtime AS control-api
COPY --from=build /out/control-api /app
# Demo data for `make demo` (the seed refuses APP_ENV=production).
COPY --from=build /repo/db/seeds /app/seeds
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build /out/worker /app
EXPOSE 4300
CMD ["node", "dist/main.js"]

FROM runtime AS web
COPY --from=build /repo/apps/web/.next/standalone /app
COPY --from=build /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /repo/apps/web/public /app/apps/web/public
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

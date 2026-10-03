# syntax=docker/dockerfile:1.7
# Builds every Go deployable from the single root module. Select one with
# --target (game-service | realtime-gateway | migrate).
FROM golang:1.26-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY db/ db/
COPY go/ go/
COPY packages/contracts/go/ packages/contracts/go/
COPY apps/game-service/ apps/game-service/
COPY apps/realtime-gateway/ apps/realtime-gateway/
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/ \
      ./apps/game-service/cmd/game-service \
      ./apps/realtime-gateway/cmd/realtime-gateway \
      ./go/cmd/migrate

FROM alpine:3.20 AS runtime
# alpine ships ca-certificates-bundle and busybox wget (used by healthchecks).
RUN addgroup -S app && adduser -S -G app app
USER app

FROM runtime AS migrate
COPY --from=build /out/migrate /usr/local/bin/migrate
ENTRYPOINT ["migrate"]

FROM runtime AS game-service
COPY --from=build /out/game-service /usr/local/bin/game-service
EXPOSE 4200
ENTRYPOINT ["game-service"]

FROM runtime AS realtime-gateway
COPY --from=build /out/realtime-gateway /usr/local/bin/realtime-gateway
EXPOSE 4100
ENTRYPOINT ["realtime-gateway"]

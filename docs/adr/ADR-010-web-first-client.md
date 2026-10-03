# ADR-010: Web/PWA client first; Unity/native clients later

Status: Accepted
Date: 2026-10-03

## Context

The project brief mentions a Unity/C# client; the architecture spec (the
authoritative document) specifies a Next.js web/PWA client first and native
clients only after web MVP validation (spec §2, Appendix C).

## Decision

Build `apps/web` (Next.js) first. Keep every gameplay rule on the server
and every client contract in `packages/contracts` (OpenAPI + realtime
schemas) so a Unity/C# client can be generated from the same documents
(e.g. NSwag/OpenAPI Generator for HTTP; the realtime schemas for message
types) without server changes.

## Consequences

A Unity client becomes an additional presentation layer (`apps/unity-client`)
when product validation justifies it. No server work is blocked on it.

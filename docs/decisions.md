# Decisions

Short log of choices made and why. Newest at the bottom.

## Storage: Cloudflare R2

Object storage for video files. R2 has no egress fees and pairs naturally with Cloudflare deploy. Not self-hosted disk (ops burden), not laptop-only serving (too fragile for clients).

## Deploy: Cloudflare (Workers)

Viewer runs as a Cloudflare Worker. Matches the existing Alchemy dependency, edge-served, cheap, scales without ops.

## Access: unguessable slug + optional password

The slug is a long random string and acts as the secret. No auth system. An optional per-video password adds a light gate for sensitive client videos. Password protects the page, not the raw media (see spec).

## Admin: local-first, push to cloud on publish

Admin metadata lives in local SQLite on the laptop. Publishing pushes media to R2 and metadata to D1. The owner only ever uses admin on their own machine, so no auth and no hosting needed.

## Viewer metadata: Cloudflare D1

Viewer needs to read metadata at the edge. D1 is SQLite-on-edge, queried directly by the Worker. Same dialect as the admin's local SQLite, so one schema and one repository serve both.

## Video format: HLS adaptive, transcoded with ffmpeg in admin

Chosen HLS for adaptive quality. Transcoding happens locally in the admin via ffmpeg on publish (not Cloudflare Stream, not progressive-only). This keeps per-minute costs at zero and gives full control, at the cost of owning the transcode step in admin. Noted tension with "ship fast"; accepted because admin is the scrappy side.

## Player: Vidstack

Modern React-based player library. Custom-styleable, supports HLS, chapters, and keyboard out of the box. Fastest path to a genuinely nice player versus building controls from scratch.

## No Drizzle — use Effect's own SQL layer

Effect v4 folds SQL into core under `effect/unstable/sql` (`SqlClient`, `SqlSchema`). Dialect packages (`@effect/sql-sqlite-bun`, `@effect/sql-d1`) provide client layers. No need for Drizzle; staying in one ecosystem keeps types and errors consistent.

## API layer: lean, not full HttpApi

Use Effect for the domain (Schema) and SQL repositories. Skip the full `HttpApi` framework. Viewer and admin use plain Worker `fetch` / `Bun.serve` routes that call the Effect repositories. Fewer beta sharp edges, less boilerplate, fits 80/20. Domain errors still carry an HTTP status via a tag→status map applied at the route edge.

## Admin frontend: foldkit

Use foldkit (`repos/foldkit`) for the admin UI. Elm-inspired, Effect-powered, and it requires the exact same `effect@4.0.0-beta.78` as the rest of the stack — no version conflict. Single architecture from frontend to backend.

## HLS delivery: R2 public bucket / custom domain

The player fetches the HLS manifest and segments directly from R2's public CDN. The Worker serves only the player page and the password gate. Simplest and fastest delivery. Trade-off: media URLs are public, so the slug is the real access barrier and the password gates the page, not the files. Acceptable for client sharing.

## alchemy.run.ts stays at root

The Alchemy CLI expects the stack file at the project root, so it stays there. If it grows unwieldy, individual resource definitions can be split into `infra/` and imported back in.

## repos/ is reference-only, left as-is

`repos/{accountability,effectv4,foldkit}` are vendored references (accountability for Effect architecture patterns, effectv4 for the authoritative v4 API source, foldkit for the admin framework). They are git subtrees and are deliberately left untouched. They are excluded from `tsconfig.json` only so `tsc` does not crawl them (which OOMs); this does not change their git tracking.

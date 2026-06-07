# videoshare

Share videos with clients and friends. Send someone a URL, they open a clean player, done.

Two sides:

- **viewer** — public, polished video player. You send a link, they watch. No login.
- **admin** — local-first, laptop-only tool to upload, transcode, and publish videos. No auth.

## Stack

Everything runs on **Effect v4** (beta). Infra via **Alchemy** on **Cloudflare**.

- `packages/shared` — domain models, repository, migrations (Effect Schema + `effect/unstable/sql`). One repository runs on local SQLite (admin) and Cloudflare D1 (viewer).
- `apps/viewer` — Cloudflare Worker. Looks up a video by slug in D1, gates on an optional password, serves a Vidstack HLS player. Segments come straight from a public R2 bucket.
- `apps/admin` — [foldkit](https://foldkit.dev) frontend (Elm-style, Effect-powered) plus a local Bun server. Upload an mp4, transcode to HLS with ffmpeg, set metadata, publish to R2 + D1.
- `alchemy.run.ts` — the Alchemy stack (R2, D1, viewer Worker).

## Docs

- [docs/spec.md](docs/spec.md) — what we're building and why
- [docs/architecture.md](docs/architecture.md) — how the pieces fit
- [docs/decisions.md](docs/decisions.md) — decisions log
- [docs/build-plan.md](docs/build-plan.md) — build order and current status
- [docs/effect-v4-notes.md](docs/effect-v4-notes.md) — Effect v4 API differences (verified against source)

## Develop

```bash
bun install
bun alchemy deploy   # provision Cloudflare resources (interactive login first time)
```

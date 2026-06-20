# Context

A project-level map of the codebase: what it is, how the pieces fit, and the affordances each part exposes.

## One-line summary

A two-sided solo video-sharing tool: a public Cloudflare-hosted player reached by unguessable URL, and a local-first admin on the laptop that transcodes uploads and pushes them to the cloud.

## Stack

- **Effect v4** (beta) end-to-end. `effect/unstable/sql` + dialect clients (`@effect/sql-sqlite-bun` locally, `@effect/sql-d1` in the worker). One repository, two backends.
- **Bun** for everything (server, build, scripts, sqlite, S3 client).
- **foldkit** for the admin UI (Elm-style Model/update/message, Effect runtime).
- **Alchemy v2** for the Cloudflare stack (Worker + R2 + D1).
- **Vidstack** for the viewer player.
- **mediabunny** + `registerMediabunnyServer` for local HLS transcode in the admin (replaced the earlier ffmpeg plan).

## Monorepo layout

```
alchemy.run.ts          Alchemy stack: R2, D1, viewer Worker
packages/shared/        Video, Chapter, Slug, Errors, Migrations, VideoRepository
apps/viewer/            Cloudflare Worker (public player, password gate, R2 proxy)
apps/admin/             server.ts (Bun REST + WebSocket) + src/ (foldkit + Vite)
repos/                  vendored reference subtrees (accountability, effectv4, foldkit), git, not built
infra/                  split-out stack pieces, only if alchemy.run.ts grows
scripts/, docs/         dev scripts, architecture/spec/decisions/build-plan
```

## The shared package is the keystone

- `Video`, `Chapter` as `Schema.Class` with branded `VideoId`, `ChapterId`, `Slug`.
- `VideoRepository` is a `Context.Service` written against the dialect-agnostic `SqlClient`. Each app provides a different client layer; the queries are identical. Repository exposes `findById`, `findBySlug`, `list`, `create`, `update`, `delete`, `listChapters`, `replaceChapters`.
- `VideoErrors` uses `Schema.TaggedErrorClass` plus a `errorStatus` map; the route layer maps tags to HTTP status. The project deliberately skips the full `HttpApi` framework.
- `Migrations` is plain `IF NOT EXISTS` DDL that runs on both SQLite and D1.
- `Slug.generateSlug` is 16 CSPRNG chars from a URL-safe alphabet.

## Data model (snake_case in DB, camelCase in TS)

- `videos`: id, slug (unique, unguessable), title, description, poster_key, hls_key, duration_sec, password_hash, created_at, published_at, updated_at.
- `chapters`: id, video_id (FK cascade), title, start_sec, sort_order.

## Viewer (`apps/viewer`) — deployed

Cloudflare Worker on `video.planetaryescape.co.za`. Bound to D1 (read) and R2 (private). Single domain for page + media so the password gate covers both.

- `GET /<slug>` → password form (POST) or Vidstack page. POST hashes the password with SHA-256 and sets a per-slug HttpOnly cookie. The page renders a `<media-player>` with the HLS manifest, a poster, a WebVTT chapter track built from the DB rows, and OG/Twitter meta.
- `GET /<slug>/<file>` → Worker looks up the video, re-checks the cookie, resolves the R2 key from `hlsKey` dir + filename, streams the object back. Path traversal is rejected. m3u8 is `no-cache`; segments are `immutable, max-age=31536000`.
- Same-origin assets: `/_assets/player.js`, `player.css`, and inline base64 favicons.
- `chaptersTrackFor` synthesises a `data:text/vtt` track from the DB rows.
- `homePage` and `/health` exist for sanity.

## Admin (`apps/admin`) — local-first

Two processes on the laptop, both driven by Bun.

### `server.ts` (Bun.serve on :3001)

- `@effect/sql-sqlite-bun` against `./videoshare-admin.db`, runs `Migrations` on boot.
- Routes (all CORS-permissive for the Vite dev server):
  - `GET /api/videos` → `repo.list`
  - `POST /api/videos` → creates a row with a fresh UUID and slug, `hlsKey: ""`, `publishedAt: null`
  - `GET /api/videos/:id` → video + chapters
  - `PUT /api/videos/:id` → updates fields and optionally replaces chapters (re-sorted by array index)
  - `DELETE /api/videos/:id` → deletes from DB and `rm -rf` the HLS output dir
  - `POST /api/upload` (multipart `videoId` + `file`) → transcode → upload to R2 → update row with `hlsKey`, `posterKey`, `durationSec`
  - `POST /api/publish/:id` → require `hlsKey` present; idempotently upload media if missing; `syncMetadata` upserts the row and chapters to D1
  - `GET /media/*` → serves transcoded HLS files locally (path-traversal blocked)
  - `WS /ws?videoId=...` → push `{stage, pct}` frames to all subscribers of that videoId
- Effect error handling: `runRoute` catches the four domain error tags, looks up the HTTP status in `errorStatus`, and pretty-prints any other cause to stderr.
- Transcode (`transcode`) uses mediabunny to write HLS (MPEG-TS segments, 6s target) with an ABR ladder of 1080/720/480 (rungs ≤ source height, else 480), AVC high-quality bitrate, AAC 128 kbps stereo, 30fps, 2s keyframe interval. Emits `transcoding` / `poster` / `done` progress frames. `writePoster` decodes one frame at +1s, rescales to ≤1280 wide, encodes a progressive JPEG via `Bun.Image`.
- `prod.ts` does the cloud sync: `S3Client` (Bun) → R2 with content-type sniff, D1 query via Cloudflare REST API (`upsertVideo` with `ON CONFLICT(id) DO UPDATE`, plus `replaceChapters`). `uploadDir` walks the local HLS dir and uploads with 8-way concurrency.

### `src/` (foldkit on Vite :5173)

- `Model` (a `Schema.Struct`): screen union (`ListVideos` | `EditVideo`), videos, edit buffers, selected `File`, upload/publish flags, `errorMessage: Option<string>`. Helpers `shareUrl`, `formatDuration`, `isPublished`, `hasUnpublishedChanges`.
- `Message`: every action is a tagged effect-schema message (`ClickedNewVideo`, `SubmittedUpload`, `ReceivedUploadProgress`, etc.) so the runtime is typed and exhaustively checked.
- `update` is a `Match.tagsExhaustive` on `Message` returning `[Model, ReadonlyArray<Command>]`. Commands live in `commands.ts` (`LoadVideos`, `CreateVideoCmd`, `UploadVideoCmd`, `PublishVideoCmd`, etc.). `evo` from `foldkit/struct` for immutable updates.
- `view` dispatches between `listVideosView` and `editVideoView` (separate files for composition discipline). Dark Tailwind v4 theme, no comments.
- `subscriptions.uploadProgress` opens a WebSocket to `:3001/ws?videoId=...` while uploading, decodes each frame with an Effect schema, and feeds `ReceivedUploadProgress` messages back into the runtime.
- `entry.ts` builds the program with `Runtime.makeProgram({ Model, init, update, view, subscriptions, container, devTools: { Message } })`.

## Alchemy (`alchemy.run.ts`)

Effect-style `Stack` with Cloudflare provider. Provisions R2 bucket, D1 with `migrationsDir: "./packages/shared/migrations"` and a seed file, and the viewer Worker bound to both, on the custom domain.

## Dev workflow

- `bun install` at the root (workspaces: `apps/*`, `packages/*`).
- `bun alchemy deploy` provisions/teardown.
- `bun run dev` runs `turbo run dev:client dev:server dev:worker`.
- Admin dev: `bun run dev:client` (Vite) + `bun run dev:server` (`bun --hot server.ts`).
- Quality: `bun run check-all` (oxlint + oxfmt --check + typecheck).

## Access model

- The 16-char slug is the secret — no auth system. Per-video SHA-256 password gate on both the page and the media, covered by the Worker proxy. Expiry/explicit-revoke are out of scope (YAGNI).

## Status

- Slice 1 (R2) and slice 2 (shared package) done.
- Slice 3 (viewer) live at `https://video.planetaryescape.co.za` with one seeded video from `demo.mov`.
- Slice 4 (admin) is scaffolded — REST API, foldkit UI with list/edit screens, transcode pipeline via mediabunny, R2/D1 sync wired. The remaining work in the plan (file upload form, chapter editing, poster preview) is partially already done in code; the checklist lags the code.
- Slice 5 (player polish) open.

## Deliberate non-goals

No accounts, comments, analytics, signed URLs, multi-CDN, or mobile admin. Mobile admin is explicitly out by design — laptop-only.

## Key references

- `docs/architecture.md:1`
- `docs/spec.md:1`
- `docs/decisions.md:1`
- `docs/build-plan.md:1`
- `apps/admin/server.ts:263`
- `apps/viewer/src/worker.ts:384`
- `packages/shared/src/VideoRepository.ts:52`
- `alchemy.run.ts:5`

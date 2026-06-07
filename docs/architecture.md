# Architecture

## Monorepo layout

```
videoshare/
├─ alchemy.run.ts        Alchemy stack: R2 bucket, D1 database, viewer Worker.
│                        Lives at root because the Alchemy CLI expects it there.
├─ infra/                Split-out stack pieces, only if alchemy.run.ts grows too big.
├─ packages/
│   └─ shared/           Domain + persistence shared by viewer and admin.
└─ apps/
    ├─ viewer/           Cloudflare Worker (public player).
    └─ admin/            foldkit frontend + local Bun server (private tool).
```

Bun workspaces (`apps/*`, `packages/*`). Bun resolves `@videoshare/shared/*` via the workspace symlink and the package `exports` map, so no TS path aliases or project references are needed.

## The shared package is the keystone

`packages/shared` holds the domain and the repository. The repository is written against the **dialect-agnostic** `SqlClient` tag from `effect/unstable/sql`. That means the exact same query code runs on:

- **local SQLite** in the admin (via `@effect/sql-sqlite-bun` → `SqliteClient.layer`)
- **Cloudflare D1** in the viewer (via `@effect/sql-d1` → `D1Client.layer`)

The dialect is chosen by which client layer each app provides. `VideoRepository.layerNoDeps` requires `SqlClient`; each app satisfies it differently.

Contents:

- `Video.ts` — `Video` and `Chapter` as `Schema.Class`, branded `VideoId` / `ChapterId` / `Slug`.
- `VideoErrors.ts` — `TaggedErrorClass` domain errors plus a tag→HTTP-status map (`statusForError`). We map status at the route edge since we are not using the full HttpApi framework.
- `VideoRepository.ts` — `Context.Service` with `findBySlug`, `list`, `create`, `update`, `listChapters`, `replaceChapters`. Built on `SqlClient`.
- `Migrations.ts` — `CREATE TABLE` statements for `videos` and `chapters`. Plain `IF NOT EXISTS` DDL that runs on both SQLite and D1.
- `Slug.ts` — unguessable slug generator (CSPRNG, 16 chars default).

Database is snake_case; TypeScript is camelCase. The SQLite/D1 clients support `transformResultNames` / `transformQueryNames` to bridge the two automatically; currently the repository maps row objects by hand for clarity.

## Data model

`videos`

| column        | type    | notes                          |
| ------------- | ------- | ------------------------------ |
| id            | TEXT PK | uuid                           |
| slug          | TEXT    | unique, unguessable            |
| title         | TEXT    |                                |
| description   | TEXT    | nullable                       |
| poster_key    | TEXT    | nullable, R2 key for poster    |
| hls_key       | TEXT    | R2 key/path to HLS master.m3u8 |
| duration_sec  | REAL    |                                |
| password_hash | TEXT    | nullable                       |
| created_at    | INTEGER | epoch millis                   |
| published_at  | INTEGER | nullable, epoch millis         |

`chapters`

| column     | type    | notes                       |
| ---------- | ------- | --------------------------- |
| id         | TEXT PK | uuid                        |
| video_id   | TEXT    | FK → videos.id, cascade     |
| title      | TEXT    |                             |
| start_sec  | REAL    |                             |
| sort_order | INTEGER |                             |

## Viewer (apps/viewer) — live

Cloudflare Worker on `video.planetaryescape.co.za`. Bound to D1 (read) and R2 (private). Serves both the player page and media files.

Flow:

1. Request `GET /<slug>`.
2. Worker provides `D1Client.layer({ db: env.DB })`, runs `VideoRepository.findBySlug`.
3. Not found → 404.
4. Has password and not yet authorized → render password prompt; `POST` checks the hash, sets a short cookie/token, re-renders.
5. Authorized (or no password) → render the Vidstack player page. The `hls_key` value (absolute URL or relative R2 key) becomes the player `src`.
6. Relative R2 keys resolve to `/<slug>/<filename>`. When the player requests a segment, the Worker looks up the video's `hls_key` directory, appends the requested file, and fetches the object from the bound R2 bucket. Auth cookie is checked on media requests too.

HLS delivery: **Worker-proxied from private R2.** The R2 bucket has no public custom domain. All media flows through the Worker on the same domain as the page, so the password gate covers both.

Player: **Vidstack** (custom controls, chapters, poster, keyboard built in). Player assets (`player.js`, `player.css`) are bundled locally and served same-origin by the Worker at `/_assets/*`.

## Admin (apps/admin) — planned

Two parts on the laptop:

- **foldkit frontend** (Vite dev server): upload UI, metadata/chapter editor, publish button. Elm-style Model/update/message, every app is an Effect program. Same Effect v4 beta as the backend.
- **local Bun server**: holds the local SQLite DB via `@effect/sql-sqlite-bun`, runs ffmpeg to transcode uploaded mp4 → HLS, and on publish uploads HLS + poster to R2 and writes the video row to D1.

Transcode: ffmpeg locally produces an HLS rendition set. (Adaptive bitrate is the goal; exact ladder TBD when we build it.)

Publish = upload media to R2 + insert/update row in D1. Local SQLite stays the working source; cloud is the published mirror the viewer reads.

## Infra (alchemy.run.ts)

Alchemy v2 (Effect-style `Stack`), Cloudflare provider.

- `R2Bucket("VideoBucket")` — live. Private, no public domain. Holds HLS segments + posters.
- `D1Database("VideoDatabase")` — live. Viewer reads it; admin writes to it on publish. Migrations from `packages/shared/migrations/`.
- `Worker("ViewerWorker")` — live on `video.planetaryescape.co.za`. Bound to D1 + R2. Serves player page, password gate, same-origin player assets, and proxies media from private R2.

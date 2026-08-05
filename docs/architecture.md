# Architecture

## Monorepo and seams

VideoShare is a Bun workspace monorepo: `apps/admin` is the local owner tool, `apps/viewer` is the public Cloudflare Worker, and `packages/shared` holds the shared domain and SQL seams. Workspace imports use `@videoshare/shared/*`.

The principal seams are:

- `AssetRepository` — local asset metadata, media replacement, and chapters.
- `ProjectRepository` — local projects, ordered one-project membership, moves, and normalization.
- `Publisher` — the admin orchestration boundary for direct-asset publication and complete project-catalog publication.
- `ViewerCatalog` — read-only published projections for direct assets and project pages/media.
- `MediaProcessor` — kind-aware local ingest: `video`, `audio`, and `image`.

`AssetRepository`, `ProjectRepository`, and `ViewerCatalog` are built on Effect's `SqlClient`. The admin provides Bun SQLite (`SqliteClient.layer`); the viewer provides D1 (`D1Client.layer`). Local SQLite is the working catalog. Published D1 is the viewer's catalog, not a second editable source.

## Catalog model and compatibility

The conceptual schema is:

- **assets** — unguessable slug, kind, title/description, optional poster, required `media_key`, timing or image dimensions, optional password, publication timestamps, and optional project membership/order.
- **projects** — unguessable slug, title/description, optional password, and publication timestamps.
- **chapters** — ordered timed-media markers belonging to an asset. Images cannot have chapters; images have zero duration and positive dimensions, while timed assets have no dimensions.

Persistence uses snake_case and domain values use camelCase. `migrate` retains compatibility with the earlier catalog: it renames `videos` to `assets`, `hls_key` to `media_key`, and `chapters.video_id` to `chapters.asset_id`, then adds the asset kind, project/order, dimensions, and update fields as needed. Existing video rows become `kind = 'video'`.

## Publication

`MediaProcessor` stores images as their original supported JPEG, PNG, or WebP; it processes video and audio into HLS (`master.m3u8`), generates a video poster, and uses MediaBunny rather than an ffmpeg-only workflow.

`Publisher` uploads an asset's R2 media prefix before publishing its D1 metadata. It writes `media/<assetId>/.complete` only after every object uploads; an absent marker makes a partial upload retryable and prevents it being treated as published media.

Direct assets publish independently. Project publication is intentionally different: it builds a **complete published project catalog snapshot**, not a selected-project-only snapshot. Each idempotent replacement includes every published project, its ordered member assets, and those members' chapters. It clears stale project memberships while retaining direct asset rows. There is no membership fingerprint or affected-project graph bookkeeping.

The D1 REST batch used for that replacement is atomic in deployed verification: against the isolated `dev_guidefari` database, a two-statement REST `/query` batch with a valid insert followed by an invalid insert returned an error and left zero rows, confirming rollback. A Worker/D1/R2 smoke-test gap remains: production deployment should prove that the Worker reads the published catalog and serves completed private R2 media end to end.

## Viewer

The Worker serves direct assets at `/<assetSlug>` and their same-origin media beneath that URL. It uses `ViewerCatalog` to expose only published rows, serves video/audio/image stages, and proxies private R2 objects; HLS manifests are not publicly hosted by R2.

Projects use:

- `/p/<projectSlug>` — first ordered member
- `/p/<projectSlug>/<assetSlug>` — a member
- `/p/<projectSlug>/summary` — completion summary
- `/p/<projectSlug>/media/<assetSlug>/…` — project-granted media

Project pages are server-rendered with the full published member catalog. The project controller swaps pre-rendered stages, manages previous/next/restart and timed-media completion, and uses browser history for member and summary navigation without client catalog reads.

Direct-asset and project access grants remain separate. A direct password cookie is scoped to `/<assetSlug>`; a project password cookie is scoped to `/p/<projectSlug>`. Project media checks the project grant and does not grant access through a direct URL (or vice versa). Existing direct URLs and cookie behavior are preserved.

## Admin

The live local admin is a Foldkit/Vite client with a Bun server, local SQLite, local media storage, upload progress over WebSocket, and Effect HTTP routes. It supports asset ingest/editing, chapters where applicable, project creation and ordered grouping, direct publishing, and project publication/unpublication.

## Infrastructure

`alchemy.run.ts` defines the live Cloudflare resources:

- `R2.Bucket("VideoBucket")` — private media storage.
- `D1.Database("VideoDatabase")` — deployed database, with migrations from `packages/shared/migrations` and the demo seed import.
- `Worker("ViewerWorker")` — `apps/viewer/src/worker.ts`, bound to `DB` and `BUCKET`, deployed at `video.planetaryescape.co.za`.

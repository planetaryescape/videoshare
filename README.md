# VideoShare

VideoShare is a local-first tool for publishing a private video, audio, image, or Markdown page and sharing it by URL. The owner prepares and publishes assets from a laptop. Recipients use a public, server-rendered viewer with no account or login.

## Capabilities

| Area | What it does |
| --- | --- |
| Assets | Creates video, audio, image, and Markdown assets with an unguessable slug, title, description, optional cover image, and optional password. |
| Media processing | Converts video and audio to multi-bitrate HLS, creates a video poster, stores supported images unchanged, and stores UTF-8 Markdown as content. |
| Chapters | Adds ordered timeline chapters to video and audio. Static assets do not have chapters. |
| Direct sharing | Publishes each asset at `/<assetSlug>`. A shared link works without a recipient account. |
| Projects | Groups assets into an ordered mixed-media project. Project links start at `/p/<projectSlug>` and provide next, previous, restart, browser-history navigation, and a completion page. |
| Access control | Uses a long random slug as the main access boundary. A direct asset or project may also have its own password. Their grants are separate. |
| Publication | Keeps editable metadata and media in local SQLite and local storage. Publishing uploads media to private R2, then writes the public catalog to D1. |
| Viewer delivery | The Cloudflare Worker renders pages, checks password grants, and proxies media from private R2. R2 objects have no public URL. |
| Observability | Emits privacy-filtered local OTLP traces for the admin. The deployed viewer uses Cloudflare Workers traces. |

## Owner workflow

1. Create an asset in the local admin.
2. Upload a supported file, or write Markdown in the editor.
3. Set its metadata, password, cover image, and—when it has a timeline—chapters.
4. Review the local result.
5. Publish the asset directly, or add assets to a project and publish the project catalog.
6. Copy the direct asset or project URL and share it.

Publishing a project writes a complete snapshot of all published projects and their ordered members. Changes to project metadata, membership, ordering, or member assets remain local until the next publish. Empty projects cannot publish.

## Public routes

| Route | Purpose |
| --- | --- |
| `/<assetSlug>` | Direct asset page. |
| `/<assetSlug>/…` | Media for that direct asset. |
| `/p/<projectSlug>` | First asset in a project. |
| `/p/<projectSlug>/<assetSlug>` | A project member. |
| `/p/<projectSlug>/summary` | Project completion page. |
| `/p/<projectSlug>/media/<assetSlug>/…` | Media reached with the project's access grant. |
| `/health` | Worker health endpoint. |

The viewer supports custom playback controls, keyboard controls, posters, and chapter tracks for timed media. It renders Markdown server-side. Raw HTML in Markdown is displayed as text; links and images use a restricted set of safe URL schemes.

## Architecture

```text
Admin laptop                         Cloudflare
────────────                         ──────────
Foldkit/Vite UI ─┐
                 ├─ Bun + Effect ── publish ──> private R2 media
Local SQLite ────┘                      │
                                        └──────> D1 published catalog

Recipient browser <── Cloudflare Worker <── D1 + private R2
```

- `apps/admin` — the local owner tool: UI, local Bun server, SQLite, media processing, publication, and progress updates over WebSocket.
- `apps/viewer` — the Cloudflare Worker that renders direct-asset and project pages and serves authorized media.
- `packages/shared` — domain models, migrations, Markdown rendering, repositories, and published-catalog queries shared by the admin and viewer.
- `alchemy.run.ts` — Cloudflare R2, D1, and Worker infrastructure.

Video and audio processing uses MediaBunny. Video uses HLS variants up to 1080p, 720p, and 480p when the source resolution allows them. Image ingest accepts JPEG, PNG, and WebP. Markdown files have a 1 MiB limit; image files have a 50 MiB limit.

## Develop

### Requirements

- [Bun](https://bun.sh/)
- Cloudflare credentials and resource IDs to publish or deploy
- A browser supported by the admin UI

Install dependencies:

```sh
bun install
```

Run the local admin UI and server:

```sh
bun run dev:client
bun run dev:server
```

The UI runs through Vite and the local server runs on port 3001. The server reads `.env`; publishing needs these variables:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_DEFAULT_ACCOUNT_ID
CLOUDFLARE_D1_DATABASE_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

Run checks:

```sh
bun run check-all
bun test
```

Provision or update Cloudflare infrastructure only when you intend to make an external change:

```sh
bun run plan
bun run deploy
```

The configured production viewer domain is `video.planetaryescape.co.za`.

## Design boundaries

VideoShare is deliberately small-scale and owner-operated. It does not provide user accounts, teams, comments, analytics dashboards, signed media URLs, DRM, expiry links, or a mobile admin app. Password protection adds a second gate, but it does not replace careful handling of shared URLs and passwords.

## Further reading

- [Product scope](docs/spec.md)
- [Architecture and publication details](docs/architecture.md)
- [Project grouping design](docs/ops-186-project-grouping.md)
- [Observability and telemetry privacy](docs/observability.md)
- [Design decisions](docs/decisions.md)
- [Effect v4 notes](docs/effect-v4-notes.md)

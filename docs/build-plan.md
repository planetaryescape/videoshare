# Build plan & status

Vertical slices, ship-fast order. Each slice should be runnable/verifiable before moving on.

## Status

- [x] **1. Infra: R2 bucket**
      `alchemy.run.ts` provisions `R2Bucket("VideoBucket")`. Deployed and confirmed live (`videoshare-videobucket-dev-guidefari-gvx6xwdfnoiqudqz`). State store bootstrapped on Cloudflare.
- [x] **2. Shared package**
      Domain (`Video`, `Chapter`, branded ids, `Slug`), `TaggedErrorClass` errors + status map, `VideoRepository` on `SqlClient`, sqlite migrations, slug generator. Verified end-to-end on real in-memory SQLite (migrate → create → findBySlug hit/miss → list). Typechecks against Effect v4.
- [x] **3. Viewer Worker**
      Add D1 to the Alchemy stack and a viewer Worker bound to D1 + R2. Worker: `GET /<slug>` → `D1Client.layer({ db })` → `findBySlug` → render Vidstack player; password gate on the page; media proxied from private R2. This slice ends with a deployed Worker serving one seeded test video.
      Deployed and live at `https://video.planetaryescape.co.za`. Worker owns the custom domain; R2 bucket stays private. Media is proxied through the Worker, so the password gate covers both the page and media requests. One seeded video from `demo.mov`, Vidstack player with poster and chapter tracks. Player assets bundled same-origin.
- [ ] **4. Admin**
      foldkit frontend + local Bun server. `@effect/sql-sqlite-bun` for local DB. Upload mp4 → ffmpeg HLS transcode → set title/chapters/poster/password → publish (upload to R2 + write row to D1).
      Scaffolded: `apps/admin/server.ts` (Bun REST API on 3001), `apps/admin/src/` (foldkit app with Vite dev server on 5173). Local SQLite with shared schema. API: list/create/upload/publish/delete videos. Foldkit UI with list/edit screens. Typechecks clean.
      Remaining: connect the publish endpoint to real D1/R2, wire the file upload form fully, add chapter editing, add poster preview.
- [ ] **5. Player polish**
      Chapters, poster, keyboard shortcuts, custom skin. Make it genuinely nice.

## Notes for the next slices

### Viewer (slice 3)

Slice is complete. Live at `https://video.planetaryescape.co.za`. Worker proxies media from private R2 on the same domain, so the password gate covers both the page and media. Player assets bundled same-origin. The one-off media prep (from `demo.mov`) proved the HLS pipeline; the admin app will later automate this.

### Admin (slice 4)

Two separate processes, both in `apps/admin/`:

**`server.ts`** - Bun REST API on port 3001
- Local SQLite via `@effect/sql-sqlite-bun` using shared schema migrations
- Endpoints: `GET/POST /api/videos`, `GET/PUT/DELETE /api/videos/:id`, `POST /api/upload` (MP4 + ffmpeg HLS transcode), `POST /api/publish/:id`, `GET /media/*` (serves transcoded HLS + poster)
- CORS enabled for Vite dev server

**`src/`** - Foldkit frontend on Vite port 5173
- Elm-architecture app (Model, Message, update, view) using foldkit + Effect
- Two screens: list view (table of local videos) and edit view (title/description/upload/publish)
- All HTTP calls proxied to the Bun server via Vite proxy config
- Tailwind v4 dark theme

**Local-first design:**
- All state lives in local SQLite first (drafts, edits)
- Publishing pushes to cloud (R2 media + D1 metadata) as an explicit action
- The app works fully offline for drafting

**Run full stack:** `bun run dev:admin` (`apps/admin/dev.ts` spawns both server + vite client, Ctrl-C kills both)

**Remaining work:**
- Connect publish endpoint to real R2 upload + D1 write (currently sets `publishedAt` locally only)
- Wire the file upload form with a real `<input type="file">` and foldkit file handling
- Chapter editing UI (add/reorder/delete chapters with start times)
- Poster preview on the edit screen
- Error display and loading state polish

## Conventions

- Bun for everything (install, run, test, build).
- Conventional commits, no co-authors.
- No comments in code unless genuinely non-obvious.
- Confirm before any deploy or outward-facing action.

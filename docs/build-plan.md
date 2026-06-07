# Build plan & status

Vertical slices, ship-fast order. Each slice should be runnable/verifiable before moving on.

## Status

- [x] **1. Infra: R2 bucket**
      `alchemy.run.ts` provisions `R2Bucket("VideoBucket")`. Deployed and confirmed live (`videoshare-videobucket-dev-guidefari-gvx6xwdfnoiqudqz`). State store bootstrapped on Cloudflare.
- [x] **2. Shared package**
      Domain (`Video`, `Chapter`, branded ids, `Slug`), `TaggedErrorClass` errors + status map, `VideoRepository` on `SqlClient`, sqlite migrations, slug generator. Verified end-to-end on real in-memory SQLite (migrate → create → findBySlug hit/miss → list). Typechecks against Effect v4.
- [x] **3. Viewer Worker**
      Add D1 to the Alchemy stack and a viewer Worker bound to D1 + R2. Worker: `GET /<slug>` → `D1Client.layer({ db })` → `findBySlug` → render Vidstack player; password gate on the page; HLS served from public R2. Make R2 publicly accessible. This slice ends with a deployed Worker serving one seeded test video.
      Deployed and live at `https://video.planetaryescape.co.za`. R2 bucket holds one seeded video (from `demo.mov`), served via absolute public-bucket URLs. Vidstack player, poster, chapter tracks. Password gate works for private videos. Worker also serves same-origin player assets.
- [ ] **4. Admin**
      foldkit frontend + local Bun server. `@effect/sql-sqlite-bun` for local DB. Upload mp4 → ffmpeg HLS transcode → set title/chapters/poster/password → publish (upload to R2 + write row to D1).
- [ ] **5. Player polish**
      Chapters, poster, keyboard shortcuts, custom skin. Make it genuinely nice.

## Notes for the next slices

### Viewer (slice 3)

Slice is complete. Live at `https://video.planetaryescape.co.za`. Media served via absolute public-bucket URLs from R2 with `video.planetaryescape.co.za` custom domain. Player assets bundled same-origin. The one-off media prep (from `demo.mov`) proved the HLS pipeline; the admin app will later automate this.

### Admin (slice 4)

- ffmpeg HLS ladder/profile is TBD; start with a single sensible rendition, expand if needed.
- Local SQLite is the working store; D1 + R2 are the published mirror.
- foldkit is Vite-based; scaffold via `create-foldkit-app` or wire the `foldkit` package directly.

## Conventions

- Bun for everything (install, run, test, build).
- Conventional commits, no co-authors.
- No comments in code unless genuinely non-obvious.
- Confirm before any deploy or outward-facing action.

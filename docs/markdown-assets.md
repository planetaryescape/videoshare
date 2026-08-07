# Markdown assets: implementation plan

Markdown becomes a 4th asset `kind`, riding the existing image precedent. `durationSec: 0`,
`width`/`height` null, content stored as a file at `media/<assetId>/content.md`, published to R2
by the untouched publish pipeline.

## Phase 1 — Domain (packages/shared)

| File | Change |
|---|---|
| `Asset.ts` | `Kind` literals gain `"markdown"` |
| `AssetErrors.ts:57` | `InvalidMediaShapeError.kind` literals gain `"markdown"`; add reason `markdownRequiresZeroDurationAndNullDimensions` |
| `AssetRepository.ts:110` | `mediaShapeError`: markdown validated like a timed asset for dimensions (null w/h) but with `durationSec === 0` |
| `prod.ts:560` | Same rule, mirrored (this is a duplicated copy of the check) |
| `MediaContentType.ts` | `.md` -> `text/markdown; charset=utf-8` |
| `Migrations.ts` | Widen CHECK to include `'markdown'` |

### The migration is the one risky step

#### Why a new kind is not a one-line change

`assets.kind` is declared with an inline constraint:

```sql
kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio', 'image'))
```

SQLite's `ALTER TABLE` supports only `RENAME`, `ADD COLUMN`, and `DROP COLUMN`. There is no
`ALTER CONSTRAINT` and no way to drop a CHECK. The constraint text is baked into the stored
`CREATE TABLE` statement in `sqlite_master`, and the only supported way to change it is the
documented **12-step table rebuild**: create a new table with the constraint you want, copy rows
across, drop the old table, rename the new one into its place.

So without the rebuild, the first `INSERT` of a markdown asset fails at runtime with
`CHECK constraint failed: assets`. The TypeScript side would be perfectly happy — `Kind` would
include `"markdown"`, the schema would validate — and the write would still be rejected by the
database. That mismatch is the actual risk: it does not surface until write time.

This is exactly what `Migrations.ts:159-172` already does for the `'image'` rollout, and the
detection is a string test against the stored DDL:

```ts
const assetsDefinition = yield* tableDefinition(sql, "assets");
if (assetsDefinition !== null && !assetsDefinition.includes("'image'")) { ...rebuild... }
```

#### Why `chapters` gets dragged in

`chapters.asset_id` carries `REFERENCES assets(id) ON DELETE CASCADE`. The rebuild does
`DROP TABLE assets`, and the existing block defends against that by copying `chapters` into
`chapters_next`, dropping it, rebuilding `assets`, then restoring `chapters` fresh.

Worth knowing why that defense is currently belt-and-braces: nothing in this codebase issues
`PRAGMA foreign_keys = ON`, and SQLite defaults it **off**, so the cascade would not actually fire
today. The existing code does not depend on that default, and neither should the new block — if
foreign keys are ever switched on, code that skipped the `chapters` dance would start silently
deleting every chapter row on migrate. Keep the dance.

#### Why one block, not two

My recommendation is to collapse the image and markdown rebuilds into a **single** block keyed on
`'markdown'`:

```ts
if (assetsDefinition !== null && !assetsDefinition.includes("'markdown'")) { ...rebuild... }
```

The reasoning: the rebuild's `CREATE TABLE assets_next` spells out the complete current schema, and
its `INSERT ... SELECT` names every column explicitly. Any database that lacks `'markdown'` — whether
it is a legacy two-kind DB or a current three-kind one — arrives at the identical final shape in one
pass. Chaining two sequential rebuilds would move a legacy DB through an intermediate three-kind
state for no benefit, doing the copy twice.

The one precondition: the `ADD COLUMN` migrations above (lines 66-88) must run **before** this
block, so a legacy DB has every column the `INSERT ... SELECT` names. They already do.

#### There are TWO migration paths, not one

An earlier draft of this doc covered only `packages/shared/src/Migrations.ts`. That is the
**local-dev SQLite migrator**, which runs idempotently on admin boot. It is not what touches
production.

Production D1 is migrated by a separate, **immutable, numbered** sequence in
`packages/shared/migrations/000N_*.sql`, applied by `alchemy.run.ts:16` via
`Cloudflare.D1.Database("VideoDatabase", { migrationsDir: "./packages/shared/migrations" })`.
`0005_add_image_kind.sql` is the D1 counterpart of the same CHECK rebuild.

Every `kind` change therefore needs **both**: the local migrator edit and a new numbered `.sql`.
Miss the second and the feature works on the laptop and fails on publish.

For markdown this is `0008_add_markdown_kind.sql`, mirroring `0005`.

**The trap it must avoid:** `0007_asset_membership_invariant.sql` creates
`assets_membership_insert`/`assets_membership_update` **without** `IF NOT EXISTS`. The rebuild's
`DROP TABLE assets` silently discards them, and because the numbered files run exactly once, they
would never come back. `0008` must recreate both triggers explicitly. This is the same trap the
"Ordering constraint" section describes for the local migrator, in the file that section did not
mention.

**Known divergence between the two paths:** local SQLite enforces project membership with triggers
*plus* a table-level `CHECK ((project_id IS NULL) = (sort_order IS NULL))`; D1 enforces it with
triggers only. `0008` preserves whatever `0005`/`0007` established rather than closing the gap.
Not a defect introduced here, but do not assume the two schemas are byte-identical.

#### Ordering constraint

Indexes and triggers are created at lines 177-191, *after* the rebuild. This is load-bearing.
`DROP TABLE assets` discards every index and trigger attached to it, so they must be recreated
afterward — which the existing `CREATE ... IF NOT EXISTS` statements at the end of `migrate` already
handle. Put the new rebuild block in the same position the old one occupies. Do not move it below
line 177.

#### Test coverage

`Migrations.test.ts` covers the image rebuild. Add cases for:
- legacy two-kind DB -> markdown, asserting rows, chapters, indexes, and triggers all survive
- current three-kind DB -> markdown, same assertions
- migrate is idempotent: running it twice is a no-op the second time
- a markdown asset actually inserts afterward (the assertion that would have caught the whole issue)

## Phase 2 — Ingest (apps/admin)

### Upload path (`MediaProcessor.ts`)

`process()` currently sniffs a 512-byte header: reject GIF/SVG, detect jpg/png/webp, else assume
A/V. Insert a markdown branch **before** the A/V fallback, gated on filename extension rather than
content sniffing (markdown has no magic bytes, and sniffing text would misclassify).

```ts
| { readonly kind: "markdown"; readonly durationSec: 0;
    readonly filename: "content.md"; readonly width: null; readonly height: null }
```

Behavior: cap size (~1MB), decode as UTF-8, reject invalid UTF-8, `resetAssetDir`, write
`content.md`, publish `done` progress. No poster, no transcode.

### Authoring path (new endpoint)

`PUT /api/assets/:id/content` in `ApiGroups.ts` — payload `Schema.Struct({ body: Schema.String })`,
success `BrowserProjectAsset`. Handler lands in `AssetsApiLive.ts`:

1. `repo.findById`, 404 if absent
2. `assertDirectAssetMutationAllowed` (published-project members stay locked, same as upload)
3. `gate.serialize` wrapper
4. Write `content.md` via `Storage`
5. `replacement.replace(old, updated)` so R2/D1 resync happens exactly as it does for uploads

Reusing `MediaReplacement` here is what keeps published markdown assets correct on edit — do not
write the file and skip it.

A matching `GET` is needed to load existing content into the editor. Cheapest: extend
`AssetWithChapters` with an optional `body` field populated only when `kind === "markdown"`, so
the existing `getAsset` call the edit page already makes carries the text. No new round trip.

### Chapters

`AssetsApiLive.ts:75` rejects chapters on images via `ImageChaptersNotAllowedError`. Markdown has no
timeline either. Either widen that error's meaning or add a sibling; widening the existing check to
`kind === "image" || kind === "markdown"` is fine, but the error *name* then lies. Recommend renaming
the condition site to a helper `isTimedKind(kind)` and keeping the wire error name stable (renaming a
serialized error tag is a breaking change for no user benefit).

## Phase 3 — Admin UI (apps/admin/src/view/editAsset.ts)

The file is 725 lines already. Put the editor in a **new** `view/markdownEditor.ts` and compose it,
per the project's smaller-components rule.

- Model: `markdownBody: string`, `markdownPreviewOpen: boolean`
- Messages: `UpdatedMarkdownBody`, `ToggledMarkdownPreview`, `ClickedSaveMarkdown`,
  `GotMarkdownSaved`
- View: monospace `Textarea` + a toggled preview pane rendering with the **same** renderer the
  viewer uses (Phase 4), so preview and production cannot drift
- `reviewPlayer` (line 91): add a markdown arm alongside the existing image arm
- Line 449 label "Upload video, audio, or image" -> add markdown
- Line 663 hides chapters for images; hide for markdown too
- Cover image upload stays available — markdown assets can still have a poster for the rail

## Phase 4 — Rendering (packages/shared, apps/viewer)

### Shared renderer

New `packages/shared/src/Markdown.ts` exporting `renderMarkdown(source: string): string`, imported
by both the viewer worker and the admin preview.

Dependency: needs a markdown parser + sanitizer that runs in a **Cloudflare Worker** (no DOM, no
Node built-ins). `marked` is dependency-free and Worker-safe. Sanitizing is the harder half —
`DOMPurify` needs a DOM. Options, in preference order:

1. `marked` with raw HTML disabled entirely (no `<...>` passthrough) — no sanitizer dep needed,
   because no user HTML ever reaches output. Given content is authored by you alone in a local
   admin, this is the right 80/20 call.
2. `marked` + `isomorphic-dompurify` if raw HTML embedding turns out to be needed later.

**Decided: option 1.** Raw HTML support is deferred, not rejected — when it is wanted, swap in
`isomorphic-dompurify` behind the same `renderMarkdown` signature and nothing else changes.

Link `rel="noopener noreferrer"` on external anchors.

### The async wrinkle (worth reading before you start)

`renderStage()` is synchronous, and `serveProject` at `worker.ts:555` maps it over **every** project
member to build the prerendered `<template>` fragments. Markdown needs its bytes from R2, which is
async. So:

- `renderStage` gains an optional pre-fetched `markdownHtml` parameter and stays sync
- `serveProject` does one `await Promise.all(...)` pass ahead of the map, fetching `content.md` from
  R2 only for members with `kind === "markdown"`, then passes the rendered HTML in

This keeps one R2 round trip per markdown member per project page load. For a project that is mostly
markdown this is the main perf consideration; acceptable at your scale, and R2 reads are cheap.
Non-markdown members cost nothing extra.

Direct single-asset pages (`worker.ts:350`) need the same treatment.

### Stage markup + CSS

```ts
if (asset.kind === "markdown")
  return `<article class="markdown-stage">${markdownHtml ?? ""}</article>`;
```

`markdownHtml` is already-sanitized trusted output — it must NOT go through `escapeHtml`.
Add `.markdown-stage` typography to `project.css` (headings, lists, code blocks, tables, max
measure ~68ch).

`project-player.ts` swaps `<template>` fragments client-side on navigation; markdown fragments are
inert HTML so this works with no client change. Verify `data-member-kind="markdown"` does not hit a
video-only branch in `project-player.ts`.

## Phase 5 — Tests

- `Migrations.test.ts` — legacy DB -> markdown CHECK rebuild preserves rows and chapters
- `AssetRepository` shape validation for the markdown kind
- `MediaProcessor.bun.test.ts` — `.md` upload produces `content.md`, rejects oversized/invalid UTF-8
- New `Markdown.test.ts` — renders common constructs, and **proves raw HTML is neutralized**
- `stage.test.ts` — markdown arm
- `project-route.test.ts` / `worker.test.ts` — project page with a markdown member
- Admin `story.test.ts` — author, save, publish a markdown asset

## Sequencing

1. Phase 1 (domain + migration) — everything else depends on the widened kind
2. Phase 4 shared renderer — needed by both admin preview and viewer
3. Phase 2 (ingest) — upload + author endpoints
4. Phase 3 (admin UI)
5. Phase 4 viewer wiring
6. Phase 5 tests alongside each phase, not bolted on at the end

Phases 1 and 4-renderer are independent and can be done in either order.

## Backward compatibility

- Existing video/audio/image assets: untouched. No column added, no column dropped.
- The migration rebuild is the only destructive-shaped operation; it is the pattern already proven
  in production by the `'image'` rollout, and it runs inside the same migrate effect.
- **Back up the local SQLite catalog before first run of the new migration.** It is a laptop-local
  file; a copy costs nothing.
- Viewer worker deploys independently — old published projects render exactly as before.

# Shareable project sequences and assets

Status: **five-slice implementation plan**

A project is both an owner's grouping and its viewer-facing ordered sequence. There is no playlist model.

## Product shape

- An asset is a video, audio recording, or static image with its own slug, publication state, and optional password.
- A project owns an ordered sequence of zero or more assets. An asset belongs to zero or one project.
- Direct asset links remain `/{assetSlug}` and use only the asset grant.
- Project links will be namespaced under `/p/{projectSlug}` and use only the project grant.
- Timed assets advance on `ended`; images advance only through explicit controls.

## Persistence direction

`assets` replaces `videos`; `media_key` replaces `hls_key`; and `chapters.asset_id` replaces `chapters.video_id`. The asset table is prepared now with nullable `project_id`, `sort_order`, `width`, and `height` columns. This slice does not implement image or project behavior.

Local SQLite is the editable catalog. D1 is the published viewer catalog. Local startup migration handles both a fresh database and an existing video catalog. D1 uses ordered SQL migrations and an idempotent seed import. Future publishing will upload required media before synchronizing a complete project catalog snapshot from SQLite to D1.

## Principal interfaces

```ts
interface AssetRepository {
  findById(id: AssetId): Effect.Effect<Option.Option<Asset>, PersistenceError>;
  findBySlug(slug: string): Effect.Effect<Option.Option<Asset>, PersistenceError>;
  list(): Effect.Effect<ReadonlyArray<Asset>, PersistenceError>;
  create(asset: Asset): Effect.Effect<Asset, PersistenceError | SlugAlreadyExistsError>;
  update(asset: Asset): Effect.Effect<Asset, PersistenceError>;
  delete(id: AssetId): Effect.Effect<void, PersistenceError>;
  listChapters(assetId: AssetId): Effect.Effect<ReadonlyArray<Chapter>, PersistenceError>;
  replaceChapters(assetId: AssetId, chapters: ReadonlyArray<Chapter>): Effect.Effect<void, PersistenceError>;
}

interface ProjectRepository {
  get(id: ProjectId): Effect.Effect<Option.Option<ProjectAggregate>, PersistenceError>;
  save(project: ProjectAggregate): Effect.Effect<ProjectAggregate, PersistenceError>;
  delete(id: ProjectId): Effect.Effect<void, PersistenceError>;
}

interface Publisher {
  publishAsset(assetId: AssetId): Effect.Effect<Asset, PublicationError>;
  publishProject(projectId: ProjectId): Effect.Effect<void, PublicationError>;
}

interface ViewerCatalog {
  findAssetPage(slug: string): Effect.Effect<Option.Option<AssetPageView>, PersistenceError>;
  findAssetMedia(slug: string): Effect.Effect<Option.Option<Asset>, PersistenceError>;
  findProjectPage(projectSlug: string, assetSlug: Option.Option<string>): Effect.Effect<Option.Option<ProjectPageView>, PersistenceError>;
  findProjectMedia(projectSlug: string, assetSlug: string): Effect.Effect<Option.Option<ProjectMediaView>, PersistenceError>;
}
```

`AssetRepository` owns local editing persistence and chapters. `ProjectRepository` will own project ordering transactions. `Publisher` will coordinate media upload and the complete D1 catalog snapshot. `ViewerCatalog` owns narrow D1 read projections: direct media reads one asset row and never loads chapters; project media will use one joined catalog query.

`MediaProcessor` is kind-aware: timed assets use the HLS path, while a later image processor will validate and store supported static images without invoking the transcoder.

## Five implementation slices

1. **Safe asset migration and direct catalog reads** — rename asset vocabulary and columns, provide fresh and upgrade-safe SQLite/D1 migration paths, and use `ViewerCatalog` for direct page and one-query media reads.
2. **Static image assets** — add image validation, dimensions, ingest, storage, publication, and direct rendering through the kind-aware `MediaProcessor`.
3. **Projects and local ordering** — add project persistence and admin editing for create, assignment, move, unfile, deletion, and contiguous ordering.
4. **Project publishing** — upload missing media, then synchronize the selected complete project catalog snapshot from SQLite to D1; finalize local publication only after that succeeds.
5. **Project viewer** — add namespaced project pages and media routes, project grants, ordered rail navigation, and timed/image progression.

## Slice 1 verification

- A fresh local SQLite database creates `assets`, `chapters.asset_id`, and the nullable project/dimension columns.
- An existing local `videos` database preserves assets, chapters, slug, media location, timestamps, and is safe to migrate twice.
- Ordered D1 SQL migrations followed by the seed create an `assets` catalog.
- A pre-migration direct slug still resolves through `AssetRepository` and `ViewerCatalog`.
- Direct media lookup succeeds without a chapters table, proving the hot path does not load chapters.

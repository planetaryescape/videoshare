import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option, Result } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Asset, AssetId, Chapter, ChapterId, ProjectId, Slug } from "./Asset.ts";
import { AssetRepository } from "./AssetRepository.ts";
import { ImageChaptersNotAllowedError, InvalidMediaShapeError } from "./AssetErrors.ts";
import { migrate } from "./Migrations.ts";
import { ViewerCatalog } from "./ViewerCatalog.ts";

const sqlLayer = () => SqliteClient.layer({ filename: ":memory:" });

const runSql = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer())));

const imageAsset = (
  overrides: Partial<{
    readonly id: string;
    readonly slug: string;
    readonly mediaKey: string;
    readonly width: number;
    readonly height: number;
  }> = {},
) =>
  new Asset({
    id: AssetId.make(overrides.id ?? "image-1"),
    slug: Slug.make(overrides.slug ?? "image_1"),
    kind: "image",
    title: "Image",
    description: null,
    posterKey: null,
    mediaKey: overrides.mediaKey ?? "media/image-1/original.png",
    durationSec: 0,
    width: overrides.width ?? 640,
    height: overrides.height ?? 480,
    passwordHash: null,
    projectId: null,
    sortOrder: null,
    createdAt: 1,
    publishedAt: 2,
    updatedAt: 3,
  });

const migrationSql = (filename: string) =>
  Bun.file(`${import.meta.dir}/../migrations/${filename}`).text();

describe("local asset migration", () => {
  test("creates the final schema on a fresh database", async () => {
    const result = await runSql(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate;
        return {
          assets: yield* sql<{
            readonly name: string;
          }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets'`,
          columns: yield* sql<{ readonly name: string }>`PRAGMA table_info(assets)`,
          chapters: yield* sql<{ readonly name: string }>`PRAGMA table_info(chapters)`,
          projects: yield* sql<{ readonly name: string }>`PRAGMA table_info(projects)`,
          projectIndexes: yield* sql<{ readonly name: string }>`PRAGMA index_list(projects)`,
          invalidMembership: yield* Effect.result(sql`
            INSERT INTO assets (id, slug, kind, title, media_key, project_id, created_at)
            VALUES ('invalid-membership', 'invalid_membership', 'video', 'Invalid', 'media/invalid/master.m3u8', 'project-1', 1)
          `),
        };
      }),
    );

    expect(result.assets).toHaveLength(1);
    expect(result.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["media_key", "project_id", "sort_order", "width", "height"]),
    );
    expect(result.chapters.map((column) => column.name)).toContain("asset_id");
    expect(result.projects.map((column) => column.name)).toEqual(
      expect.arrayContaining(["slug", "password_hash", "published_at"]),
    );
    expect(result.projectIndexes.map((index) => index.name)).not.toContain("idx_projects_slug");
    expect(Result.isFailure(result.invalidMembership)).toBe(true);
  });

  test("removes the redundant local slug index without relaxing slug uniqueness", async () => {
    const result = await runSql(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          CREATE TABLE assets (
            id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'video',
            title TEXT NOT NULL, description TEXT, poster_key TEXT, media_key TEXT NOT NULL,
            duration_sec REAL NOT NULL DEFAULT 0, password_hash TEXT, created_at INTEGER NOT NULL,
            published_at INTEGER, updated_at INTEGER
          )
        `;
        yield* sql`CREATE INDEX idx_assets_slug ON assets (slug)`;
        yield* migrate;
        yield* sql`INSERT INTO assets (id, slug, kind, title, media_key, duration_sec, created_at) VALUES ('asset-1', 'same-slug', 'video', 'One', 'assets/one/master.m3u8', 0, 1)`;
        const duplicate = yield* Effect.exit(
          sql`INSERT INTO assets (id, slug, kind, title, media_key, duration_sec, created_at) VALUES ('asset-2', 'same-slug', 'video', 'Two', 'assets/two/master.m3u8', 0, 1)`,
        );
        return {
          redundantIndex: yield* sql<{
            readonly name: string;
          }>`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_assets_slug'`,
          duplicate,
        };
      }),
    );

    expect(result.redundantIndex).toEqual([]);
    expect(result.duplicate._tag).toBe("Failure");
  });

  test("upgrades legacy rows and remains idempotent", async () => {
    const result = await runSql(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          CREATE TABLE videos (
            id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT,
            poster_key TEXT, hls_key TEXT NOT NULL, duration_sec REAL NOT NULL DEFAULT 0,
            password_hash TEXT, created_at INTEGER NOT NULL, published_at INTEGER
          )
        `;
        yield* sql`
          CREATE TABLE chapters (
            id TEXT PRIMARY KEY, video_id TEXT NOT NULL, title TEXT NOT NULL,
            start_sec REAL NOT NULL, sort_order INTEGER NOT NULL
          )
        `;
        yield* sql`INSERT INTO videos VALUES ('asset-1', 'legacy_slug', 'Legacy', NULL, NULL, 'assets/asset-1/master.m3u8', 10, NULL, 12, 13)`;
        yield* sql`INSERT INTO chapters VALUES ('chapter-1', 'asset-1', 'Start', 0, 0)`;
        yield* migrate;
        yield* migrate;
        return {
          asset: yield* sql<{
            readonly media_key: string;
            readonly kind: string;
            readonly updated_at: number;
          }>`SELECT media_key, kind, updated_at FROM assets WHERE id = 'asset-1'`,
          chapter: yield* sql<{
            readonly asset_id: string;
          }>`SELECT asset_id FROM chapters WHERE id = 'chapter-1'`,
          videos: yield* sql<{
            readonly name: string;
          }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'videos'`,
          invalidKind: yield* Effect.result(sql`
            INSERT INTO assets (id, slug, kind, title, media_key, created_at)
            VALUES ('invalid-kind', 'invalid_kind', 'invalid', 'Invalid', 'media/invalid/master.m3u8', 1)
          `),
        };
      }),
    );

    expect(result.asset).toEqual([
      { media_key: "assets/asset-1/master.m3u8", kind: "video", updated_at: 12 },
    ]);
    expect(result.chapter).toEqual([{ asset_id: "asset-1" }]);
    expect(result.videos).toEqual([]);
    expect(Result.isFailure(result.invalidKind)).toBe(true);
  });
});

test("adds published_at to an existing local projects table idempotently", async () => {
  const result = await runSql(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
          description TEXT, password_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER
        )
      `;
      yield* migrate;
      yield* migrate;
      return yield* sql<{ readonly name: string }>`PRAGMA table_info(projects)`;
    }),
  );

  expect(result.map((column) => column.name)).toContain("published_at");
});

describe("D1 SQL path", () => {
  test("applies ordered migrations and the seed to a fresh catalog", async () => {
    const database = new Database(":memory:");
    try {
      for (const filename of [
        "0001_init.sql",
        "0002_add_updated_at.sql",
        "0003_add_kind.sql",
        "0004_assets.sql",
        "0005_add_image_kind.sql",
        "0006_projects.sql",
        "0007_asset_membership_invariant.sql",
      ]) {
        database.exec(await migrationSql(filename));
      }
      database.exec(await Bun.file(`${import.meta.dir}/../seed/0001_demo_video.sql`).text());
      const asset = database
        .query<{ readonly media_key: string; readonly kind: string }, []>(
          "SELECT media_key, kind FROM assets WHERE id = 'demo-video-0001'",
        )
        .get();
      const chapter = database
        .query<{ readonly asset_id: string }, []>(
          "SELECT asset_id FROM chapters WHERE id = 'demo-chapter-0001'",
        )
        .get();
      const columns = database
        .query<{ readonly name: string }, []>("PRAGMA table_info(assets)")
        .all();
      const redundantIndex = database
        .query<{ readonly name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_assets_slug'",
        )
        .all();
      const projectColumns = database
        .query<{ readonly name: string }, []>("PRAGMA table_info(projects)")
        .all();
      const projectIndexes = database
        .query<{ readonly name: string }, []>("PRAGMA index_list(projects)")
        .all();

      expect(() =>
        database.exec(`
          INSERT INTO assets (id, slug, kind, title, media_key, duration_sec, created_at)
          VALUES ('duplicate-demo-video', 'demo_7yQn3rLp9Ks4Vm2x', 'video', 'Duplicate', 'videos/duplicate/master.m3u8', 0, 1)
        `),
      ).toThrow();
      expect(redundantIndex).toEqual([]);
      expect(asset).toEqual({ media_key: "videos/demo/master.m3u8", kind: "video" });
      expect(chapter).toEqual({ asset_id: "demo-video-0001" });
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["project_id", "sort_order", "width", "height"]),
      );
      expect(projectColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["slug", "password_hash", "published_at"]),
      );
      expect(projectIndexes.map((index) => index.name)).not.toContain("idx_projects_slug");
      database.exec(`
        INSERT INTO assets (id, slug, kind, title, media_key, created_at)
        VALUES ('image-1', 'image_1', 'image', 'Image', 'media/image-1/original.png', 1)
      `);
      expect(
        database
          .query<{ readonly kind: string }, []>("SELECT kind FROM assets WHERE id = 'image-1'")
          .get(),
      ).toEqual({ kind: "image" });
    } finally {
      database.close();
    }
  });

  test("rebuilds an upgraded D1 catalog while preserving rows and schema invariants", async () => {
    const database = new Database(":memory:");
    try {
      for (const filename of [
        "0001_init.sql",
        "0002_add_updated_at.sql",
        "0003_add_kind.sql",
        "0004_assets.sql",
      ]) {
        database.exec(await migrationSql(filename));
      }
      database.exec(await Bun.file(`${import.meta.dir}/../seed/0001_demo_video.sql`).text());
      // Pre-0005 catalogs may retain this index despite slug's UNIQUE constraint.
      database.exec("CREATE INDEX idx_assets_slug ON assets (slug)");
      database.exec(await migrationSql("0005_add_image_kind.sql"));
      database.exec(await migrationSql("0006_projects.sql"));
      database.exec(await migrationSql("0007_asset_membership_invariant.sql"));

      const asset = database
        .query<
          {
            readonly id: string;
            readonly slug: string;
            readonly media_key: string;
            readonly kind: string;
          },
          []
        >("SELECT id, slug, media_key, kind FROM assets WHERE id = 'demo-video-0001'")
        .get();
      const chapter = database
        .query<{ readonly id: string; readonly asset_id: string }, []>(
          "SELECT id, asset_id FROM chapters WHERE id = 'demo-chapter-0001'",
        )
        .get();
      const demoRows = database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM assets WHERE id = 'demo-video-0001'",
        )
        .get();
      const redundantIndex = database
        .query<{ readonly name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_assets_slug'",
        )
        .all();
      const projectColumns = database
        .query<{ readonly name: string }, []>("PRAGMA table_info(projects)")
        .all();
      const projectIndexes = database
        .query<{ readonly name: string }, []>("PRAGMA index_list(projects)")
        .all();
      database.exec(`
        INSERT INTO projects (id, slug, title, created_at)
        VALUES ('project-1', 'project_1', 'Project', 3)
      `);

      expect(asset).toEqual({
        id: "demo-video-0001",
        slug: "demo_7yQn3rLp9Ks4Vm2x",
        media_key: "videos/demo/master.m3u8",
        kind: "video",
      });
      expect(chapter).toEqual({ id: "demo-chapter-0001", asset_id: "demo-video-0001" });
      expect(redundantIndex).toEqual([]);
      expect(() =>
        database.exec(`
          INSERT INTO assets (id, slug, kind, title, media_key, created_at)
          VALUES ('duplicate-demo-video', 'demo_7yQn3rLp9Ks4Vm2x', 'video', 'Duplicate', 'videos/duplicate/master.m3u8', 1)
        `),
      ).toThrow();
      expect(demoRows).toEqual({ count: 1 });
      expect(projectColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["slug", "password_hash", "published_at"]),
      );
      expect(projectIndexes.map((index) => index.name)).not.toContain("idx_projects_slug");
      database.exec(`
        INSERT INTO assets (id, slug, kind, title, media_key, created_at) VALUES
          ('audio-1', 'audio_1', 'audio', 'Audio', 'media/audio-1/master.m3u8', 2),
          ('image-1', 'image_1', 'image', 'Image', 'media/image-1/original.webp', 2)
      `);
      expect(() =>
        database.exec(`
          INSERT INTO assets (id, slug, kind, title, media_key, created_at)
          VALUES ('invalid-1', 'invalid_1', 'document', 'Invalid', 'media/invalid.pdf', 2)
        `),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});

describe("asset persistence and viewer catalog", () => {
  test("binds replacement chapters to the requested asset", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer);
    const chapters = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate;
        yield* sql`INSERT INTO assets (id, slug, kind, title, description, poster_key, media_key, duration_sec, password_hash, created_at, published_at, updated_at) VALUES ('target-asset', 'target_asset', 'audio', 'Target', NULL, NULL, 'assets/target/master.m3u8', 0, NULL, 1, NULL, 1)`;
        yield* sql`INSERT INTO assets (id, slug, kind, title, description, poster_key, media_key, duration_sec, password_hash, created_at, published_at, updated_at) VALUES ('other-asset', 'other_asset', 'audio', 'Other', NULL, NULL, 'assets/other/master.m3u8', 0, NULL, 1, NULL, 1)`;
        const repository = yield* AssetRepository;
        const targetId = AssetId.make("target-asset");
        yield* repository.replaceChapters(targetId, [
          new Chapter({
            id: ChapterId.make("chapter-1"),
            assetId: AssetId.make("other-asset"),
            title: "Intro",
            startSec: 0,
            sortOrder: 0,
          }),
        ]);
        return yield* repository.listChapters(targetId);
      }).pipe(Effect.provide(layer)),
    );

    expect(chapters).toHaveLength(1);
    expect(String(chapters[0]?.assetId)).toBe("target-asset");
  });

  test("replaces media atomically and clears chapters for an image", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const repository = yield* AssetRepository;
        yield* migrate;
        const video = new Asset({
          ...imageAsset(),
          kind: "video",
          mediaKey: "media/image-1/master.m3u8",
          width: null,
          height: null,
        });
        yield* repository.create(video);
        yield* repository.replaceChapters(video.id, [
          new Chapter({
            id: ChapterId.make("chapter-1"),
            assetId: video.id,
            title: "Start",
            startSec: 0,
            sortOrder: 0,
          }),
        ]);
        yield* sql`CREATE TRIGGER reject_chapter_delete BEFORE DELETE ON chapters BEGIN SELECT RAISE(ABORT, 'blocked'); END`;
        const failed = yield* Effect.result(repository.replaceMedia(imageAsset()));
        const afterFailure = yield* repository.findById(video.id);
        const chaptersAfterFailure = yield* repository.listChapters(video.id);
        yield* sql`DROP TRIGGER reject_chapter_delete`;
        yield* repository.replaceMedia(imageAsset());
        const chaptersAfterImage = yield* repository.listChapters(video.id);
        return { failed, afterFailure, chaptersAfterFailure, chaptersAfterImage };
      }).pipe(Effect.provide(layer)),
    );

    expect(Result.isFailure(result.failed)).toBe(true);
    expect(Option.getOrNull(result.afterFailure)?.kind).toBe("video");
    expect(result.chaptersAfterFailure).toHaveLength(1);
    expect(result.chaptersAfterImage).toHaveLength(0);
  });

  test("rejects chapters for image assets at the SQLite repository boundary", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* AssetRepository;
        const image = imageAsset();
        yield* migrate;
        yield* repository.create(image);
        const replaced = yield* Effect.result(
          repository.replaceChapters(image.id, [
            new Chapter({
              id: ChapterId.make("image-chapter-1"),
              assetId: image.id,
              title: "Not allowed",
              startSec: 0,
              sortOrder: 0,
            }),
          ]),
        );
        return { replaced, chapters: yield* repository.listChapters(image.id) };
      }).pipe(Effect.provide(layer)),
    );

    expect(Result.isFailure(result.replaced)).toBe(true);
    if (Result.isFailure(result.replaced)) {
      expect(result.replaced.failure).toBeInstanceOf(ImageChaptersNotAllowedError);
    }
    expect(result.chapters).toHaveLength(0);
  });

  test("update cannot bypass a media transition", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* AssetRepository;
        const video = new Asset({
          ...imageAsset(),
          kind: "video",
          mediaKey: "media/image-1/master.m3u8",
          durationSec: 12,
          width: null,
          height: null,
        });
        yield* migrate;
        yield* repository.create(video);
        yield* repository.update(
          new Asset({
            ...video,
            kind: "image",
            mediaKey: "media/image-1/original.webp",
            durationSec: 0,
            width: 1200,
            height: 800,
            title: "Updated title",
          }),
        );
        return yield* repository.findById(video.id);
      }).pipe(Effect.provide(layer)),
    );

    expect(Option.getOrNull(result)).toMatchObject({
      kind: "video",
      mediaKey: "media/image-1/master.m3u8",
      durationSec: 12,
      width: null,
      height: null,
      title: "Updated title",
    });
  });

  test("rejects invalid media shapes before a SQLite create", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* AssetRepository;
        yield* migrate;
        const invalidImage = yield* Effect.result(
          repository.create(
            new Asset({ ...imageAsset(), durationSec: 1, width: 640, height: 480 }),
          ),
        );
        return { invalidImage, persisted: yield* repository.findById(imageAsset().id) };
      }).pipe(Effect.provide(layer)),
    );

    expect(Result.isFailure(result.invalidImage)).toBe(true);
    if (Result.isFailure(result.invalidImage)) {
      expect(result.invalidImage.failure).toBeInstanceOf(InvalidMediaShapeError);
    }
    expect(Option.isNone(result.persisted)).toBe(true);
  });

  test("rejects invalid media shapes before a SQLite media transition", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* AssetRepository;
        const video = new Asset({
          ...imageAsset(),
          kind: "video",
          mediaKey: "media/image-1/master.m3u8",
          durationSec: 12,
          width: null,
          height: null,
        });
        yield* migrate;
        yield* repository.create(video);
        const invalidImage = yield* Effect.result(
          repository.replaceMedia(
            new Asset({
              ...video,
              kind: "image",
              mediaKey: "media/image-1/original.png",
              durationSec: 1,
              width: 640,
              height: 480,
            }),
          ),
        );
        const invalidTimed = yield* Effect.result(
          repository.replaceMedia(new Asset({ ...video, width: 640, height: 480 })),
        );
        return {
          invalidImage,
          invalidTimed,
          persisted: yield* repository.findById(video.id),
        };
      }).pipe(Effect.provide(layer)),
    );

    for (const transition of [result.invalidImage, result.invalidTimed]) {
      expect(Result.isFailure(transition)).toBe(true);
      if (Result.isFailure(transition)) {
        expect(transition.failure).toBeInstanceOf(InvalidMediaShapeError);
      }
    }
    expect(Option.getOrNull(result.persisted)).toMatchObject({
      kind: "video",
      mediaKey: "media/image-1/master.m3u8",
      durationSec: 12,
      width: null,
      height: null,
    });
  });

  test("round-trips published image dimensions and media key through repository and viewer catalog", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const catalogLayer = ViewerCatalog.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer, catalogLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* AssetRepository;
        const catalog = yield* ViewerCatalog;
        yield* migrate;
        const image = new Asset({
          ...imageAsset({
            mediaKey: "media/image-1/original.webp",
            width: 1200,
            height: 800,
          }),
          projectId: ProjectId.make("project-1"),
          sortOrder: 0,
        });
        yield* repository.create(image);
        return yield* catalog.findAssetMedia(String(image.slug));
      }).pipe(Effect.provide(layer)),
    );

    expect(Option.getOrNull(result)).toMatchObject({
      kind: "image",
      mediaKey: "media/image-1/original.webp",
      width: 1200,
      height: 800,
      projectId: "project-1",
      sortOrder: 0,
    });
  });

  test("preserves a migrated direct-link slug and reads media without chapters", async () => {
    const database = sqlLayer();
    const repositoryLayer = AssetRepository.layerNoDeps.pipe(Layer.provide(database));
    const catalogLayer = ViewerCatalog.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, repositoryLayer, catalogLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate;
        yield* sql`INSERT INTO assets (id, slug, kind, title, description, poster_key, media_key, duration_sec, password_hash, created_at, published_at, updated_at) VALUES ('asset-1', 'legacy_slug', 'video', 'Legacy', NULL, NULL, 'assets/asset-1/master.m3u8', 10, 'hash', 12, 13, 12)`;
        yield* sql`DROP TABLE chapters`;
        const catalog = yield* ViewerCatalog;
        const media = yield* catalog.findAssetMedia("legacy_slug");
        const repository = yield* AssetRepository;
        const asset = yield* repository.findBySlug("legacy_slug");
        return { media, asset };
      }).pipe(Effect.provide(layer)),
    );

    expect(Option.getOrNull(result.media)?.mediaKey).toBe("assets/asset-1/master.m3u8");
    expect(String(Option.getOrNull(result.asset)?.slug)).toBe("legacy_slug");
  });

  test("maps malformed project rows to PersistenceError at every project catalog call site", async () => {
    const database = sqlLayer();
    const catalogLayer = ViewerCatalog.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, catalogLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const catalog = yield* ViewerCatalog;
        yield* migrate;
        yield* sql`INSERT INTO projects (id, slug, title, created_at, published_at) VALUES ('malformed', 'malformed', '', 1, 2)`;
        yield* sql`INSERT INTO assets (id, slug, kind, title, media_key, project_id, sort_order, created_at, published_at) VALUES ('member', 'member', 'video', 'Member', 'media/member/master.m3u8', 'malformed', 0, 1, 2)`;
        return {
          page: yield* Effect.result(catalog.findProjectPage("malformed", null)),
          media: yield* Effect.result(catalog.findProjectMedia("malformed", "member")),
        };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.page).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PersistenceError", operation: "findProjectPage" },
    });
    expect(result.media).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PersistenceError", operation: "findProjectMedia" },
    });
  });

  test("projects resolve a default or deep member without chapters, while unknown and unpublished members are absent", async () => {
    const database = sqlLayer();
    const catalogLayer = ViewerCatalog.layerNoDeps.pipe(Layer.provide(database));
    const layer = Layer.mergeAll(database, catalogLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const catalog = yield* ViewerCatalog;
        yield* migrate;
        yield* sql`INSERT INTO projects (id, slug, title, created_at, published_at) VALUES ('project-1', 'project_1', 'Project', 1, 2)`;
        yield* sql`INSERT INTO assets (id, slug, kind, title, media_key, project_id, sort_order, created_at, published_at) VALUES ('member-1', 'member_1', 'video', 'Member', 'media/member-1/master.m3u8', 'project-1', 0, 1, 2)`;
        yield* sql`INSERT INTO assets (id, slug, kind, title, media_key, project_id, sort_order, created_at, published_at) VALUES ('draft-1', 'draft_1', 'video', 'Draft', 'media/draft-1/master.m3u8', 'project-1', 1, 1, NULL)`;
        yield* sql`INSERT INTO chapters (id, asset_id, title, start_sec, sort_order) VALUES ('chapter-1', 'member-1', 'Ignored', 0, 0)`;
        return {
          root: yield* catalog.findProjectPage("project_1", null),
          deep: yield* catalog.findProjectPage("project_1", "member_1"),
          unknown: yield* catalog.findProjectPage("project_1", "missing"),
          draft: yield* catalog.findProjectPage("project_1", "draft_1"),
          media: yield* catalog.findProjectMedia("project_1", "member_1"),
        };
      }).pipe(Effect.provide(layer)),
    );
    expect(String(Option.getOrNull(result.root)?.selected.slug)).toBe("member_1");
    expect(Option.getOrNull(result.deep)?.assets).toHaveLength(1);
    expect(String(Option.getOrNull(result.deep)?.selected.slug)).toBe("member_1");
    expect(Option.isNone(result.unknown)).toBe(true);
    expect(Option.isNone(result.draft)).toBe(true);
    expect(String(Option.getOrNull(result.media)?.asset.slug)).toBe("member_1");
  });
});

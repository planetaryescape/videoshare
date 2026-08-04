import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { AssetId, Chapter } from "./Asset.ts";
import { AssetRepository } from "./AssetRepository.ts";
import { migrate } from "./Migrations.ts";
import { ViewerCatalog } from "./ViewerCatalog.ts";

const sqlLayer = () => SqliteClient.layer({ filename: ":memory:" });

const runSql = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer())));

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
        };
      }),
    );

    expect(result.assets).toHaveLength(1);
    expect(result.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["media_key", "project_id", "sort_order", "width", "height"]),
    );
    expect(result.chapters.map((column) => column.name)).toContain("asset_id");
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
        };
      }),
    );

    expect(result.asset).toEqual([
      { media_key: "assets/asset-1/master.m3u8", kind: "video", updated_at: 12 },
    ]);
    expect(result.chapter).toEqual([{ asset_id: "asset-1" }]);
    expect(result.videos).toEqual([]);
  });
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
      ]) {
        database.exec(await Bun.file(`${import.meta.dir}/../migrations/${filename}`).text());
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
    } finally {
      database.close();
    }
  });

  test("upgrades an existing D1 catalog without duplicating seeded media", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE videos (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT,
          poster_key TEXT,
          hls_key TEXT NOT NULL,
          duration_sec REAL NOT NULL DEFAULT 0,
          password_hash TEXT,
          created_at INTEGER NOT NULL,
          published_at INTEGER,
          updated_at INTEGER,
          kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio'))
        );
        CREATE INDEX idx_videos_slug ON videos (slug);
        CREATE TABLE chapters (
          id TEXT PRIMARY KEY,
          video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          start_sec REAL NOT NULL,
          sort_order INTEGER NOT NULL
        );
        CREATE INDEX idx_chapters_video ON chapters (video_id);
        INSERT INTO videos VALUES (
          'demo-video-0001', 'demo_7yQn3rLp9Ks4Vm2x', 'VideoShare demo',
          'First video published through the live stack. Transferred from demo.mov with poster extraction and HLS transcoding.',
          'videos/demo/poster.jpg', 'videos/demo/master.m3u8', 6.4, NULL,
          1749254400000, 1749254400000, 1749254400000, 'video'
        );
        INSERT INTO chapters VALUES ('demo-chapter-0001', 'demo-video-0001', 'Intro', 0, 0);
      `);
      database.exec(await Bun.file(`${import.meta.dir}/../migrations/0004_assets.sql`).text());
      database.exec(await Bun.file(`${import.meta.dir}/../seed/0001_demo_video.sql`).text());

      const asset = database
        .query<{ readonly id: string; readonly slug: string; readonly media_key: string }, []>(
          "SELECT id, slug, media_key FROM assets WHERE id = 'demo-video-0001'",
        )
        .get();
      const chapter = database
        .query<{ readonly id: string; readonly asset_id: string }, []>(
          "SELECT id, asset_id FROM chapters WHERE id = 'demo-chapter-0001'",
        )
        .get();
      const demoRows = database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM assets WHERE slug = 'demo_7yQn3rLp9Ks4Vm2x'",
        )
        .get();

      expect(asset).toEqual({
        id: "demo-video-0001",
        slug: "demo_7yQn3rLp9Ks4Vm2x",
        media_key: "videos/demo/master.m3u8",
      });
      expect(chapter).toEqual({ id: "demo-chapter-0001", asset_id: "demo-video-0001" });
      expect(demoRows).toEqual({ count: 1 });
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
            id: "chapter-1",
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
});

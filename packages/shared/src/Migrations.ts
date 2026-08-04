import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

interface TableRow {
  readonly name: string;
}

interface ColumnRow {
  readonly name: string;
}

const hasTable = (sql: SqlClient.SqlClient, table: string) =>
  sql<TableRow>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`.pipe(
    Effect.map((rows) => rows.length > 0),
  );

const columnsFor = (sql: SqlClient.SqlClient, table: "assets" | "chapters") => {
  const query =
    table === "assets"
      ? sql<ColumnRow>`PRAGMA table_info(assets)`
      : sql<ColumnRow>`PRAGMA table_info(chapters)`;
  return query.pipe(Effect.map((rows) => new Set(rows.map((row) => row.name))));
};

/** Migrates the local SQLite catalog to the current asset schema. */
export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const hasAssets = yield* hasTable(sql, "assets");
  const hasLegacyVideos = yield* hasTable(sql, "videos");

  if (!hasAssets && hasLegacyVideos) {
    yield* sql`ALTER TABLE videos RENAME TO assets`;
  }

  const assetsExist = yield* hasTable(sql, "assets");
  if (!assetsExist) {
    yield* sql`
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'video',
        title TEXT NOT NULL,
        description TEXT,
        poster_key TEXT,
        media_key TEXT NOT NULL,
        duration_sec REAL NOT NULL DEFAULT 0,
        password_hash TEXT,
        created_at INTEGER NOT NULL,
        published_at INTEGER,
        updated_at INTEGER
      )
    `;
  }

  const assetColumns = yield* columnsFor(sql, "assets");
  if (assetColumns.has("hls_key") && !assetColumns.has("media_key")) {
    yield* sql`ALTER TABLE assets RENAME COLUMN hls_key TO media_key`;
  }

  const finalAssetColumns = yield* columnsFor(sql, "assets");
  if (!finalAssetColumns.has("updated_at"))
    yield* sql`ALTER TABLE assets ADD COLUMN updated_at INTEGER`;
  if (!finalAssetColumns.has("kind")) {
    yield* sql`ALTER TABLE assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'video'`;
  }
  if (!finalAssetColumns.has("project_id")) {
    yield* sql`ALTER TABLE assets ADD COLUMN project_id TEXT`;
  }
  if (!finalAssetColumns.has("sort_order")) {
    yield* sql`ALTER TABLE assets ADD COLUMN sort_order INTEGER`;
  }
  if (!finalAssetColumns.has("width")) {
    yield* sql`ALTER TABLE assets ADD COLUMN width INTEGER`;
  }
  if (!finalAssetColumns.has("height")) {
    yield* sql`ALTER TABLE assets ADD COLUMN height INTEGER`;
  }
  yield* sql`UPDATE assets SET updated_at = created_at WHERE updated_at IS NULL`;
  yield* sql`UPDATE assets SET kind = 'video' WHERE kind IS NULL`;
  yield* sql`DROP INDEX IF EXISTS idx_videos_slug`;
  yield* sql`DROP INDEX IF EXISTS idx_assets_slug`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_assets_project ON assets (project_id, sort_order)`;
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_position ON assets (project_id, sort_order) WHERE project_id IS NOT NULL`;

  const chaptersExist = yield* hasTable(sql, "chapters");
  if (!chaptersExist) {
    yield* sql`
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        start_sec REAL NOT NULL,
        sort_order INTEGER NOT NULL
      )
    `;
  } else {
    const chapterColumns = yield* columnsFor(sql, "chapters");
    if (chapterColumns.has("video_id") && !chapterColumns.has("asset_id")) {
      yield* sql`ALTER TABLE chapters RENAME COLUMN video_id TO asset_id`;
    }
  }
  yield* sql`DROP INDEX IF EXISTS idx_chapters_video`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_chapters_asset ON chapters (asset_id)`;
});

import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

interface TableRow {
  readonly name: string;
  readonly sql?: string;
}

interface ColumnRow {
  readonly name: string;
}

const tableDefinition = (sql: SqlClient.SqlClient, table: string) =>
  sql<TableRow>`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = ${table}`.pipe(
    Effect.map((rows) => rows[0]?.sql ?? null),
  );

const hasTable = (sql: SqlClient.SqlClient, table: string) =>
  tableDefinition(sql, table).pipe(Effect.map((definition) => definition !== null));

const columnsFor = (sql: SqlClient.SqlClient, table: "assets" | "chapters" | "projects") => {
  const query =
    table === "assets"
      ? sql<ColumnRow>`PRAGMA table_info(assets)`
      : table === "chapters"
        ? sql<ColumnRow>`PRAGMA table_info(chapters)`
        : sql<ColumnRow>`PRAGMA table_info(projects)`;
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
        kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio', 'image', 'markdown')),
        title TEXT NOT NULL,
        description TEXT,
        poster_key TEXT,
        media_key TEXT NOT NULL,
        duration_sec REAL NOT NULL DEFAULT 0,
        password_hash TEXT,
        project_id TEXT,
        sort_order INTEGER,
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL,
        published_at INTEGER,
        updated_at INTEGER,
        CHECK ((project_id IS NULL) = (sort_order IS NULL))
      )
    `;
  }

  const assetColumns = yield* columnsFor(sql, "assets");
  if (assetColumns.has("hls_key") && !assetColumns.has("media_key")) {
    yield* sql`ALTER TABLE assets RENAME COLUMN hls_key TO media_key`;
  }

  const finalAssetColumns = yield* columnsFor(sql, "assets");
  const addedUpdatedAt = !finalAssetColumns.has("updated_at");
  if (addedUpdatedAt) yield* sql`ALTER TABLE assets ADD COLUMN updated_at INTEGER`;
  if (!finalAssetColumns.has("kind")) {
    yield* sql`ALTER TABLE assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio', 'image', 'markdown'))`;
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
  // `summary` is a project route, so persisted member assets need an addressable slug.
  yield* sql`
    WITH RECURSIVE candidates(id, slug, suffix) AS (
      SELECT id, 'asset-' || id, 0 FROM assets WHERE slug = 'summary'
      UNION ALL
      SELECT id, 'asset-' || id || '-' || (suffix + 1), suffix + 1
      FROM candidates
      WHERE EXISTS (SELECT 1 FROM assets existing WHERE existing.slug = candidates.slug)
    )
    UPDATE assets
    SET slug = (
      SELECT candidates.slug
      FROM candidates
      WHERE NOT EXISTS (SELECT 1 FROM assets existing WHERE existing.slug = candidates.slug)
      LIMIT 1
    )
    WHERE slug = 'summary'
  `;
  if (addedUpdatedAt)
    yield* sql`UPDATE assets SET updated_at = created_at WHERE updated_at IS NULL`;
  // Projects are deliberately independent from SQLite foreign-key enforcement: deletion explicitly unfiles members.
  yield* sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      password_hash TEXT,
      created_at INTEGER NOT NULL,
      published_at INTEGER,
      updated_at INTEGER
    )
  `;
  const projectColumns = yield* columnsFor(sql, "projects");
  if (!projectColumns.has("published_at"))
    yield* sql`ALTER TABLE projects ADD COLUMN published_at INTEGER`;
  // Tracks the remote catalog snapshot independently from editable local membership.
  yield* sql`
    CREATE TABLE IF NOT EXISTS published_project_members (
      asset_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL
    )
  `;
  // Existing catalogs can seed only their current published membership; subsequent snapshot writes
  // maintain this table even if a member is later unfiled locally.
  yield* sql`
    INSERT OR IGNORE INTO published_project_members (asset_id, project_id)
    SELECT assets.id, assets.project_id
    FROM assets
    JOIN projects ON projects.id = assets.project_id
    WHERE assets.project_id IS NOT NULL AND projects.published_at IS NOT NULL
  `;

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
  const assetsDefinition = yield* tableDefinition(sql, "assets");
  if (assetsDefinition !== null && !assetsDefinition.includes("'markdown'")) {
    // Preserve child rows while rebuilding the CHECK constraint. Any DB reaching this
    // branch (legacy two-kind or current three-kind) ends up at the identical final
    // shape in one pass, so a single block handles both starting points.
    yield* sql`CREATE TABLE chapters_next (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, title TEXT NOT NULL, start_sec REAL NOT NULL, sort_order INTEGER NOT NULL)`;
    yield* sql`INSERT INTO chapters_next (id, asset_id, title, start_sec, sort_order) SELECT id, asset_id, title, start_sec, sort_order FROM chapters`;
    yield* sql`DROP TABLE chapters`;
    yield* sql`CREATE TABLE assets_next (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio', 'image', 'markdown')), title TEXT NOT NULL, description TEXT, poster_key TEXT, media_key TEXT NOT NULL, duration_sec REAL NOT NULL DEFAULT 0, password_hash TEXT, project_id TEXT, sort_order INTEGER, width INTEGER, height INTEGER, created_at INTEGER NOT NULL, published_at INTEGER, updated_at INTEGER, CHECK ((project_id IS NULL) = (sort_order IS NULL)))`;
    yield* sql`INSERT INTO assets_next (id, slug, kind, title, description, poster_key, media_key, duration_sec, password_hash, project_id, sort_order, width, height, created_at, published_at, updated_at) SELECT id, slug, kind, title, description, poster_key, media_key, duration_sec, password_hash, project_id, sort_order, width, height, created_at, published_at, updated_at FROM assets`;
    yield* sql`DROP TABLE assets`;
    yield* sql`ALTER TABLE assets_next RENAME TO assets`;
    yield* sql`CREATE TABLE chapters (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, title TEXT NOT NULL, start_sec REAL NOT NULL, sort_order INTEGER NOT NULL)`;
    yield* sql`INSERT INTO chapters (id, asset_id, title, start_sec, sort_order) SELECT id, asset_id, title, start_sec, sort_order FROM chapters_next`;
    yield* sql`DROP TABLE chapters_next`;
  }

  yield* sql`DROP INDEX IF EXISTS idx_videos_slug`;
  yield* sql`DROP INDEX IF EXISTS idx_assets_slug`;
  yield* sql`DROP INDEX IF EXISTS idx_chapters_video`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_assets_project ON assets (project_id, sort_order)`;
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_position ON assets (project_id, sort_order) WHERE project_id IS NOT NULL`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_chapters_asset ON chapters (asset_id)`;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS assets_membership_insert
    BEFORE INSERT ON assets
    WHEN (NEW.project_id IS NULL) != (NEW.sort_order IS NULL)
    BEGIN SELECT RAISE(ABORT, 'asset project membership fields must both be null or set'); END
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS assets_membership_update
    BEFORE UPDATE OF project_id, sort_order ON assets
    WHEN (NEW.project_id IS NULL) != (NEW.sort_order IS NULL)
    BEGIN SELECT RAISE(ABORT, 'asset project membership fields must both be null or set'); END
  `;
});

-- D1 does not support toggling foreign_keys. Preserve child rows outside the FK
-- while rebuilding assets, then restore the child table and its constraint.
CREATE TABLE chapters_next (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_sec REAL NOT NULL,
  sort_order INTEGER NOT NULL
);

INSERT INTO chapters_next (id, asset_id, title, start_sec, sort_order)
  SELECT id, asset_id, title, start_sec, sort_order FROM chapters;
DROP TABLE chapters;

CREATE TABLE assets_next (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio', 'image')),
  title TEXT NOT NULL,
  description TEXT,
  poster_key TEXT,
  media_key TEXT NOT NULL,
  duration_sec REAL NOT NULL DEFAULT 0,
  password_hash TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  updated_at INTEGER,
  project_id TEXT,
  sort_order INTEGER,
  width INTEGER,
  height INTEGER
);

INSERT INTO assets_next (
  id, slug, kind, title, description, poster_key, media_key, duration_sec,
  password_hash, created_at, published_at, updated_at, project_id, sort_order, width, height
)
  SELECT id, CASE WHEN slug = 'summary' THEN 'asset-' || id ELSE slug END,
         kind, title, description, poster_key, media_key, duration_sec,
         password_hash, created_at, published_at, updated_at, project_id, sort_order, width, height
  FROM assets;
-- slug's UNIQUE constraint already creates its index. Older catalogs may retain this redundant index.
DROP INDEX IF EXISTS idx_assets_slug;
DROP TABLE assets;
ALTER TABLE assets_next RENAME TO assets;

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_sec REAL NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT INTO chapters (id, asset_id, title, start_sec, sort_order)
  SELECT id, asset_id, title, start_sec, sort_order FROM chapters_next;
DROP TABLE chapters_next;

CREATE INDEX idx_assets_project ON assets (project_id, sort_order);
CREATE UNIQUE INDEX idx_assets_project_position ON assets (project_id, sort_order) WHERE project_id IS NOT NULL;
CREATE INDEX idx_chapters_asset ON chapters (asset_id);

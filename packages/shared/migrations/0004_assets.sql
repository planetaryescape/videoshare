ALTER TABLE videos RENAME TO assets;
ALTER TABLE assets RENAME COLUMN hls_key TO media_key;
ALTER TABLE chapters RENAME COLUMN video_id TO asset_id;

ALTER TABLE assets ADD COLUMN project_id TEXT;
ALTER TABLE assets ADD COLUMN sort_order INTEGER;
ALTER TABLE assets ADD COLUMN width INTEGER;
ALTER TABLE assets ADD COLUMN height INTEGER;

DROP INDEX IF EXISTS idx_videos_slug;
DROP INDEX IF EXISTS idx_chapters_video;
DROP INDEX IF EXISTS idx_assets_slug;
CREATE INDEX idx_assets_project ON assets (project_id, sort_order);
CREATE UNIQUE INDEX idx_assets_project_position ON assets (project_id, sort_order) WHERE project_id IS NOT NULL;
CREATE INDEX idx_chapters_asset ON chapters (asset_id);

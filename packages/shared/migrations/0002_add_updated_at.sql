ALTER TABLE videos ADD COLUMN updated_at INTEGER;

UPDATE videos SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE videos ADD COLUMN kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'audio'));

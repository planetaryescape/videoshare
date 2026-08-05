CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  password_hash TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  updated_at INTEGER
);

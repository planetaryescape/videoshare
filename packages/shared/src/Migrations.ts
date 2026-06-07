import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

export const migrate = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      poster_key TEXT,
      hls_key TEXT NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      password_hash TEXT,
      created_at INTEGER NOT NULL,
      published_at INTEGER
    )
  `

  yield* sql`CREATE INDEX IF NOT EXISTS idx_videos_slug ON videos (slug)`

  yield* sql`
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_sec REAL NOT NULL,
      sort_order INTEGER NOT NULL
    )
  `

  yield* sql`CREATE INDEX IF NOT EXISTS idx_chapters_video ON chapters (video_id)`
})

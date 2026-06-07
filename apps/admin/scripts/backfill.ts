import { Database } from "bun:sqlite"
import { pushToProd } from "../src/prod"

const slug = process.argv[2]
if (!slug) {
  console.error("usage: bun scripts/backfill.ts <slug>")
  process.exit(1)
}

const db = new Database("./videoshare-admin.db")
const v = db.query("SELECT * FROM videos WHERE slug = ?").get(slug) as Record<string, unknown> | null
if (!v) {
  console.error(`no video with slug ${slug}`)
  process.exit(1)
}

const chRows = db
  .query("SELECT * FROM chapters WHERE video_id = ? ORDER BY sort_order")
  .all(v.id as string) as Array<Record<string, unknown>>

const video = {
  id: v.id as string,
  slug: v.slug as string,
  title: v.title as string,
  description: (v.description as string | null) ?? null,
  posterKey: (v.poster_key as string | null) ?? null,
  hlsKey: v.hls_key as string,
  durationSec: v.duration_sec as number,
  passwordHash: (v.password_hash as string | null) ?? null,
  createdAt: v.created_at as number,
  publishedAt: (v.published_at as number | null) ?? null,
}

const chapters = chRows.map((c) => ({
  id: c.id as string,
  videoId: c.video_id as string,
  title: c.title as string,
  startSec: c.start_sec as number,
  sortOrder: c.sort_order as number,
}))

console.log(`pushing ${video.id} (${video.slug}), chapters: ${chapters.length}`)
await pushToProd(video, chapters, `./videoshare-hls-output/${video.id}`)
console.log("DONE")

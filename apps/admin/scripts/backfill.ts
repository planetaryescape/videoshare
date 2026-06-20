import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { Chapter, ChapterId, Slug, Video, VideoId } from "@videoshare/shared/Video";
import { pushToProd } from "../src/prod";

const slug = process.argv[2];
if (!slug) {
  process.stderr.write("usage: bun scripts/backfill.ts <slug>\n");
  process.exit(1);
}

const db = new Database("./videoshare-admin.db");
const v = db.query("SELECT * FROM videos WHERE slug = ?").get(slug) as Record<
  string,
  unknown
> | null;
if (!v) {
  process.stderr.write(`no video with slug ${slug}\n`);
  process.exit(1);
}

const chRows = db
  .query("SELECT * FROM chapters WHERE video_id = ? ORDER BY sort_order")
  .all(v.id as string) as Array<Record<string, unknown>>;

const video = new Video({
  id: VideoId.make(v.id as string),
  slug: Slug.make(v.slug as string),
  title: v.title as string,
  description: (v.description as string | null) ?? null,
  posterKey: (v.poster_key as string | null) ?? null,
  hlsKey: v.hls_key as string,
  durationSec: v.duration_sec as number,
  passwordHash: (v.password_hash as string | null) ?? null,
  createdAt: v.created_at as number,
  publishedAt: (v.published_at as number | null) ?? null,
  updatedAt: (v.updated_at as number | null) ?? null,
});

const chapters = chRows.map(
  (c) =>
    new Chapter({
      id: ChapterId.make(c.id as string),
      videoId: VideoId.make(c.video_id as string),
      title: c.title as string,
      startSec: c.start_sec as number,
      sortOrder: c.sort_order as number,
    }),
);

process.stdout.write(`pushing ${video.id} (${video.slug}), chapters: ${chapters.length}\n`);
await Effect.runPromise(pushToProd(video, chapters, `./videoshare-hls-output/${video.id}`));
process.stdout.write("DONE\n");

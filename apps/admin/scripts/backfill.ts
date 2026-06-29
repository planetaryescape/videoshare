import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { Chapter, ChapterId, Slug, Video, VideoId } from "@videoshare/shared/Video";
import { pushToProd } from "../src/prod";

const slug = process.argv[2];
if (!slug) {
  process.stderr.write("usage: bun scripts/backfill.ts <slug>\n");
  process.exit(1);
}

const pickString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`expected string at ${key}, got ${typeof value}`);
  }
  return value;
};

const pickNumber = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  if (typeof value !== "number") {
    throw new Error(`expected number at ${key}, got ${typeof value}`);
  }
  return value;
};

const pickNullableString = (row: Record<string, unknown>, key: string): string | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`expected string|null at ${key}, got ${typeof value}`);
  }
  return value;
};

const pickNullableNumber = (row: Record<string, unknown>, key: string): number | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new Error(`expected number|null at ${key}, got ${typeof value}`);
  }
  return value;
};

const db = new Database("./videoshare-admin.db");
const v: Record<string, unknown> | null = db
  .query<Record<string, unknown>, [string]>("SELECT * FROM videos WHERE slug = ?")
  .get(slug);
if (v === null) {
  process.stderr.write(`no video with slug ${slug}\n`);
  process.exit(1);
}
const videoRow: Record<string, unknown> = v;

const chRows: ReadonlyArray<Record<string, unknown>> = db
  .query<Record<string, unknown>, [string]>(
    "SELECT * FROM chapters WHERE video_id = ? ORDER BY sort_order",
  )
  .all(pickString(videoRow, "id"));

const video: Video = new Video({
  id: VideoId.make(pickString(videoRow, "id")),
  slug: Slug.make(pickString(videoRow, "slug")),
  title: pickString(videoRow, "title"),
  description: pickNullableString(videoRow, "description"),
  posterKey: pickNullableString(videoRow, "poster_key"),
  hlsKey: pickString(videoRow, "hls_key"),
  durationSec: pickNumber(videoRow, "duration_sec"),
  passwordHash: pickNullableString(videoRow, "password_hash"),
  createdAt: pickNumber(videoRow, "created_at"),
  publishedAt: pickNullableNumber(videoRow, "published_at"),
  updatedAt: pickNullableNumber(videoRow, "updated_at"),
});

const chapters: ReadonlyArray<Chapter> = chRows.map(
  (c): Chapter =>
    new Chapter({
      id: ChapterId.make(pickString(c, "id")),
      videoId: VideoId.make(pickString(c, "video_id")),
      title: pickString(c, "title"),
      startSec: pickNumber(c, "start_sec"),
      sortOrder: pickNumber(c, "sort_order"),
    }),
);

process.stdout.write(`pushing ${video.id} (${video.slug}), chapters: ${chapters.length}\n`);
await Effect.runPromise(pushToProd(video, chapters, `./videoshare-hls-output/${video.id}`));
process.stdout.write("DONE\n");

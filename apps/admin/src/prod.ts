import { S3Client } from "bun";
import { readdir } from "node:fs/promises";
import { Effect } from "effect";
import type { Chapter, Video } from "@videoshare/shared/Video";
import { ProdSyncError } from "@videoshare/shared/VideoErrors";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
};

const accountId = () => required("CLOUDFLARE_DEFAULT_ACCOUNT_ID");
const apiToken = () => required("CLOUDFLARE_API_TOKEN");
const databaseId = () => required("CLOUDFLARE_D1_DATABASE_ID");

const r2 = () =>
  new S3Client({
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET"),
    endpoint: `https://${accountId()}.r2.cloudflarestorage.com`,
  });

const prodFail = (operation: string) =>
  Effect.mapError((cause: unknown) => new ProdSyncError({ operation, cause }));

type D1Param = string | number | null;

const d1Query = (sql: string, params: ReadonlyArray<D1Param>) =>
  Effect.tryPromise(async () => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId()}/d1/database/${databaseId()}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    if (!response.ok) {
      throw new Error(`D1 query failed (${response.status}): ${await response.text()}`);
    }
    const result = (await response.json()) as {
      success: boolean;
      errors?: ReadonlyArray<{ message: string }>;
    };
    if (!result.success) {
      throw new Error(
        `D1 query error: ${result.errors?.map((e) => e.message).join(", ") ?? "unknown"}`,
      );
    }
  });

const contentType = (key: string): string => {
  if (key.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (key.endsWith(".ts")) return "video/mp2t";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
};

interface UploadFile {
  readonly localPath: string;
  readonly key: string;
}

const collectFiles = (
  localDir: string,
  keyPrefix: string,
): Effect.Effect<ReadonlyArray<UploadFile>> =>
  Effect.gen(function* () {
    const entries = yield* Effect.promise(() => readdir(localDir, { withFileTypes: true }));
    const files: Array<UploadFile> = [];
    for (const entry of entries) {
      const localPath = `${localDir}/${entry.name}`;
      const key = `${keyPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        files.push(...(yield* collectFiles(localPath, key)));
      } else if (entry.isFile()) {
        files.push({ localPath, key });
      }
    }
    return files;
  });

const uploadConcurrency = 8;

const uploadDir = (localDir: string, keyPrefix: string) =>
  Effect.gen(function* () {
    const client = r2();
    const files = yield* collectFiles(localDir, keyPrefix);
    yield* Effect.forEach(
      files,
      ({ localPath, key }) =>
        Effect.tryPromise(() => client.write(key, Bun.file(localPath), { type: contentType(key) })),
      { concurrency: uploadConcurrency, discard: true },
    );
  }).pipe(prodFail("uploadDir"));

const upsertVideo = (video: Video) =>
  d1Query(
    `INSERT INTO videos (id, slug, title, description, poster_key, hls_key, duration_sec, password_hash, created_at, published_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       slug = excluded.slug,
       title = excluded.title,
       description = excluded.description,
       poster_key = excluded.poster_key,
       hls_key = excluded.hls_key,
       duration_sec = excluded.duration_sec,
       password_hash = excluded.password_hash,
       published_at = excluded.published_at,
       updated_at = excluded.updated_at`,
    [
      video.id,
      video.slug,
      video.title,
      video.description,
      video.posterKey,
      video.hlsKey,
      video.durationSec,
      video.passwordHash,
      video.createdAt,
      video.publishedAt,
      video.updatedAt,
    ],
  );

const replaceChapters = (videoId: string, chapters: ReadonlyArray<Chapter>) =>
  Effect.gen(function* () {
    yield* d1Query(`DELETE FROM chapters WHERE video_id = ?`, [videoId]);
    for (const chapter of chapters) {
      yield* d1Query(
        `INSERT INTO chapters (id, video_id, title, start_sec, sort_order) VALUES (?, ?, ?, ?, ?)`,
        [chapter.id, chapter.videoId, chapter.title, chapter.startSec, chapter.sortOrder],
      );
    }
  });

export const uploadMedia = (videoId: string, localMediaDir: string) =>
  uploadDir(localMediaDir, `media/${videoId}`);

export const mediaExists = (videoId: string) =>
  Effect.tryPromise(() => r2().exists(`media/${videoId}/master.m3u8`)).pipe(
    prodFail("mediaExists"),
  );

export const syncMetadata = (video: Video, chapters: ReadonlyArray<Chapter>) =>
  Effect.gen(function* () {
    yield* upsertVideo(video);
    yield* replaceChapters(video.id, chapters);
  }).pipe(prodFail("syncMetadata"));

export const pushToProd = (video: Video, chapters: ReadonlyArray<Chapter>, localMediaDir: string) =>
  Effect.gen(function* () {
    yield* uploadMedia(video.id, localMediaDir);
    yield* syncMetadata(video, chapters);
  });

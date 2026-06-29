import { S3Client } from "bun";
import { readdir } from "node:fs/promises";
import { Context, Effect, Layer, Option, Schema as S } from "effect";
import type { Chapter, Video } from "@videoshare/shared/Video";
import { ProdSyncError } from "@videoshare/shared/VideoErrors";

const wrapProdError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ProdSyncError, R> =>
    Effect.mapError(effect, (cause) => new ProdSyncError({ operation, cause }));

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

type D1Param = string | number | null;

const D1Response = S.Struct({
  success: S.Boolean,
  errors: S.optional(S.Array(S.Struct({ message: S.String }))),
});

const d1Query = (sql: string, params: ReadonlyArray<D1Param>) =>
  Effect.tryPromise({
    try: async () => {
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
      const raw: unknown = await response.json();
      const decoded = S.decodeUnknownOption(D1Response)(raw);
      if (Option.isNone(decoded)) {
        throw new Error("D1 query returned unexpected shape");
      }
      const result = decoded.value;
      if (!result.success) {
        throw new Error(
          `D1 query error: ${result.errors?.map((e) => e.message).join(", ") ?? "unknown"}`,
        );
      }
    },
    catch: (cause) => new ProdSyncError({ operation: "d1Query", cause }),
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
        Effect.tryPromise({
          try: () => client.write(key, Bun.file(localPath), { type: contentType(key) }),
          catch: (cause) => new ProdSyncError({ operation: "r2.write", cause }),
        }),
      { concurrency: uploadConcurrency, discard: true },
    );
  }).pipe(wrapProdError("uploadDir"));

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

const listPrefixKeys = (prefix: string) =>
  Effect.gen(function* () {
    const client = r2();
    const keys: Array<string> = [];
    let startAfter: string | undefined;
    while (true) {
      const page = yield* Effect.tryPromise({
        try: () =>
          client.list({
            prefix,
            maxKeys: 1000,
            ...(startAfter !== undefined ? { startAfter } : {}),
          }),
        catch: (cause) => new ProdSyncError({ operation: "r2.list", cause }),
      });
      for (const obj of page.contents ?? []) {
        if (obj.key) keys.push(obj.key);
      }
      if (!page.isTruncated) return keys;
      const next = page.contents?.at(-1)?.key;
      if (!next) return keys;
      startAfter = next;
    }
  });

const removeR2Prefix = (videoId: string) =>
  Effect.gen(function* () {
    const client = r2();
    const keys = yield* listPrefixKeys(`media/${videoId}/`);
    yield* Effect.forEach(
      keys,
      (key) =>
        Effect.tryPromise({
          try: () => client.delete(key),
          catch: (cause) => new ProdSyncError({ operation: "r2.delete", cause }),
        }),
      { concurrency: 8, discard: true },
    );
  }).pipe(wrapProdError("removeMedia"));

const unpublishVideo = (videoId: string) =>
  d1Query(`UPDATE videos SET published_at = NULL WHERE id = ?`, [videoId]).pipe(
    wrapProdError("unpublish"),
  );

const deleteVideoRow = (videoId: string) =>
  d1Query(`DELETE FROM videos WHERE id = ?`, [videoId]).pipe(wrapProdError("removeFromProd"));

export interface ProdSyncService {
  readonly uploadMedia: (
    videoId: string,
    localMediaDir: string,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly mediaExists: (videoId: string) => Effect.Effect<boolean, ProdSyncError>;
  readonly syncMetadata: (
    video: Video,
    chapters: ReadonlyArray<Chapter>,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly pushToProd: (
    video: Video,
    chapters: ReadonlyArray<Chapter>,
    localMediaDir: string,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly removeMedia: (videoId: string) => Effect.Effect<void, ProdSyncError>;
  readonly unpublish: (videoId: string) => Effect.Effect<void, ProdSyncError>;
  readonly removeFromProd: (videoId: string) => Effect.Effect<void, ProdSyncError>;
}

export class ProdSync extends Context.Service<ProdSync, ProdSyncService>()("admin/ProdSync") {
  static readonly layer: Layer.Layer<ProdSync> = Layer.succeed(
    ProdSync,
    ProdSync.of({
      uploadMedia: (videoId, localMediaDir) => uploadDir(localMediaDir, `media/${videoId}`),
      mediaExists: (videoId) =>
        Effect.tryPromise({
          try: () => r2().exists(`media/${videoId}/master.m3u8`),
          catch: (cause) => new ProdSyncError({ operation: "mediaExists", cause }),
        }).pipe(wrapProdError("mediaExists")),
      syncMetadata: (video, chapters) =>
        Effect.gen(function* () {
          yield* upsertVideo(video);
          yield* replaceChapters(video.id, chapters);
        }).pipe(wrapProdError("syncMetadata")),
      pushToProd: (video, chapters, localMediaDir) =>
        Effect.gen(function* () {
          yield* uploadDir(localMediaDir, `media/${video.id}`);
          yield* upsertVideo(video);
          yield* replaceChapters(video.id, chapters);
        }).pipe(wrapProdError("pushToProd")),
      removeMedia: (videoId) => removeR2Prefix(videoId),
      unpublish: (videoId) => unpublishVideo(videoId),
      removeFromProd: (videoId) =>
        Effect.gen(function* () {
          yield* removeR2Prefix(videoId);
          yield* deleteVideoRow(videoId);
        }),
    }),
  );
}

export const uploadMedia = (videoId: string, localMediaDir: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.uploadMedia(videoId, localMediaDir);
  }).pipe(Effect.provide(ProdSync.layer));

export const mediaExists = (videoId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.mediaExists(videoId);
  }).pipe(Effect.provide(ProdSync.layer));

export const syncMetadata = (video: Video, chapters: ReadonlyArray<Chapter>) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.syncMetadata(video, chapters);
  }).pipe(Effect.provide(ProdSync.layer));

export const pushToProd = (video: Video, chapters: ReadonlyArray<Chapter>, localMediaDir: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.pushToProd(video, chapters, localMediaDir);
  }).pipe(Effect.provide(ProdSync.layer));

export const removeMedia = (videoId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.removeMedia(videoId);
  }).pipe(Effect.provide(ProdSync.layer));

export const unpublish = (videoId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.unpublish(videoId);
  }).pipe(Effect.provide(ProdSync.layer));

export const removeFromProd = (videoId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.removeFromProd(videoId);
  }).pipe(Effect.provide(ProdSync.layer));

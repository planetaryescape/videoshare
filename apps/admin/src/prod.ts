import { S3Client } from "bun";
import { readdir } from "node:fs/promises";
import { Context, Effect, Layer, Option, Schema as S } from "effect";
import type { Chapter, Asset } from "@videoshare/shared/Asset";
import { ProdSyncError } from "@videoshare/shared/AssetErrors";

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
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
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

const upsertAsset = (video: Asset) =>
  d1Query(
    `INSERT INTO assets (id, slug, kind, title, description, poster_key, media_key, duration_sec, width, height, password_hash, created_at, published_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       slug = excluded.slug,
       kind = excluded.kind,
       title = excluded.title,
       description = excluded.description,
       poster_key = excluded.poster_key,
       media_key = excluded.media_key,
       duration_sec = excluded.duration_sec,
       width = excluded.width,
       height = excluded.height,
       password_hash = excluded.password_hash,
       published_at = excluded.published_at,
       updated_at = excluded.updated_at`,
    [
      video.id,
      video.slug,
      video.kind,
      video.title,
      video.description,
      video.posterKey,
      video.mediaKey,
      video.durationSec,
      video.width,
      video.height,
      video.passwordHash,
      video.createdAt,
      video.publishedAt,
      video.updatedAt,
    ],
  );

const replaceChapters = (assetId: string, chapters: ReadonlyArray<Chapter>) =>
  Effect.gen(function* () {
    yield* d1Query(`DELETE FROM chapters WHERE asset_id = ?`, [assetId]);
    for (const chapter of chapters) {
      yield* d1Query(
        `INSERT INTO chapters (id, asset_id, title, start_sec, sort_order) VALUES (?, ?, ?, ?, ?)`,
        [chapter.id, chapter.assetId, chapter.title, chapter.startSec, chapter.sortOrder],
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

const removeR2Prefix = (assetId: string) =>
  Effect.gen(function* () {
    const client = r2();
    const keys = yield* listPrefixKeys(`media/${assetId}/`);
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

const unpublishAsset = (assetId: string) =>
  d1Query(`UPDATE assets SET published_at = NULL WHERE id = ?`, [assetId]).pipe(
    wrapProdError("unpublish"),
  );

const deleteAssetRow = (assetId: string) =>
  d1Query(`DELETE FROM assets WHERE id = ?`, [assetId]).pipe(wrapProdError("removeFromProd"));

export interface ProdSyncService {
  readonly uploadMedia: (
    assetId: string,
    localMediaDir: string,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly mediaExists: (mediaKey: string) => Effect.Effect<boolean, ProdSyncError>;
  readonly syncMetadata: (
    video: Asset,
    chapters: ReadonlyArray<Chapter>,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly pushToProd: (
    video: Asset,
    chapters: ReadonlyArray<Chapter>,
    localMediaDir: string,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly removeMedia: (assetId: string) => Effect.Effect<void, ProdSyncError>;
  readonly unpublish: (assetId: string) => Effect.Effect<void, ProdSyncError>;
  readonly removeFromProd: (assetId: string) => Effect.Effect<void, ProdSyncError>;
}

export class ProdSync extends Context.Service<ProdSync, ProdSyncService>()("admin/ProdSync") {
  static readonly layer: Layer.Layer<ProdSync> = Layer.succeed(
    ProdSync,
    ProdSync.of({
      uploadMedia: (assetId, localMediaDir) => uploadDir(localMediaDir, `media/${assetId}`),
      mediaExists: (mediaKey) =>
        Effect.tryPromise({
          try: () => r2().exists(mediaKey),
          catch: (cause) => new ProdSyncError({ operation: "mediaExists", cause }),
        }).pipe(wrapProdError("mediaExists")),
      syncMetadata: (video, chapters) =>
        Effect.gen(function* () {
          yield* upsertAsset(video);
          yield* replaceChapters(video.id, chapters);
        }).pipe(wrapProdError("syncMetadata")),
      pushToProd: (video, chapters, localMediaDir) =>
        Effect.gen(function* () {
          yield* uploadDir(localMediaDir, `media/${video.id}`);
          yield* upsertAsset(video);
          yield* replaceChapters(video.id, chapters);
        }).pipe(wrapProdError("pushToProd")),
      removeMedia: (assetId) => removeR2Prefix(assetId),
      unpublish: (assetId) => unpublishAsset(assetId),
      removeFromProd: (assetId) =>
        Effect.gen(function* () {
          yield* removeR2Prefix(assetId);
          yield* deleteAssetRow(assetId);
        }),
    }),
  );
}

export const uploadMedia = (assetId: string, localMediaDir: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.uploadMedia(assetId, localMediaDir);
  }).pipe(Effect.provide(ProdSync.layer));

export const mediaExists = (mediaKey: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.mediaExists(mediaKey);
  }).pipe(Effect.provide(ProdSync.layer));

export const syncMetadata = (video: Asset, chapters: ReadonlyArray<Chapter>) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.syncMetadata(video, chapters);
  }).pipe(Effect.provide(ProdSync.layer));

export const pushToProd = (video: Asset, chapters: ReadonlyArray<Chapter>, localMediaDir: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.pushToProd(video, chapters, localMediaDir);
  }).pipe(Effect.provide(ProdSync.layer));

export const removeMedia = (assetId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.removeMedia(assetId);
  }).pipe(Effect.provide(ProdSync.layer));

export const unpublish = (assetId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.unpublish(assetId);
  }).pipe(Effect.provide(ProdSync.layer));

export const removeFromProd = (assetId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.removeFromProd(assetId);
  }).pipe(Effect.provide(ProdSync.layer));

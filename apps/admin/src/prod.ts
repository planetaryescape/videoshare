import { S3Client } from "bun";
import { readdir } from "node:fs/promises";
import { Context, Effect, Layer, Option, Schema as S } from "effect";
import { Asset, AssetId, type Chapter, type ProjectId } from "@videoshare/shared/Asset";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import type { ProjectAggregate } from "@videoshare/shared/Project";
import { mediaContentType } from "@videoshare/shared/MediaContentType";
import { r2KeyDir } from "@videoshare/shared/MediaKey";
import type { PersistenceError, SlugAlreadyExistsError } from "@videoshare/shared/AssetErrors";
import {
  AssetNotFoundError,
  AssetPublicationValidationError,
  InvalidMediaShapeError,
  ProdSyncError,
  ProjectNotFoundError,
  ProjectPublicationValidationError,
} from "@videoshare/shared/AssetErrors";
import { Storage } from "./services/Storage.ts";

const isAbsoluteHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

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
const maxD1BatchStatements = 100;
const maxD1BatchPayloadBytes = 1_000_000;

const D1Response = S.Struct({
  success: S.Boolean,
  errors: S.optional(S.Array(S.Struct({ message: S.String }))),
});
const D1BatchResponse = S.Struct({
  success: S.Boolean,
  errors: S.optional(S.Array(S.Struct({ message: S.String }))),
  result: S.Array(D1Response),
});

export interface D1Statement {
  readonly sql: string;
  readonly params: ReadonlyArray<D1Param>;
}

/** Builds the documented D1 REST batch request envelope. */
export const d1BatchRequest = (statements: ReadonlyArray<D1Statement>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ batch: statements }),
});

/** Decodes one D1 REST batch envelope and requires every statement to have succeeded. */
export const isSuccessfulD1BatchResponse = (
  raw: unknown,
  submittedStatements: ReadonlyArray<D1Statement>,
): boolean => {
  const decoded = S.decodeUnknownOption(D1BatchResponse)(raw);
  return (
    Option.isSome(decoded) &&
    decoded.value.success &&
    decoded.value.result.length === submittedStatements.length &&
    decoded.value.result.every((result) => result.success)
  );
};

/**
 * Runtime verification: production deployment must confirm the account/API version executes this
 * documented batch request atomically; the REST contract alone does not prove deployed atomicity.
 */
const d1Batch = (statements: ReadonlyArray<D1Statement>) => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ batch: statements })).byteLength;
  if (statements.length > maxD1BatchStatements || payloadBytes > maxD1BatchPayloadBytes)
    return Effect.fail(
      new ProdSyncError({
        operation: "d1Batch",
        cause: new Error(
          `D1 batch exceeds limits: ${statements.length} statements, ${payloadBytes} bytes`,
        ),
      }),
    );
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId()}/d1/database/${databaseId()}/query`,
        {
          ...d1BatchRequest(statements),
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${apiToken()}`,
            "content-type": "application/json",
          },
        },
      );
      if (!response.ok)
        throw new Error(`D1 batch failed (${response.status}): ${await response.text()}`);
      const raw: unknown = await response.json();
      if (!isSuccessfulD1BatchResponse(raw, statements))
        throw new Error("D1 batch returned an unsuccessful result");
    },
    catch: (cause) => new ProdSyncError({ operation: "d1Batch", cause }),
  });
};

const d1Query = (sql: string, params: ReadonlyArray<D1Param>) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId()}/d1/database/${databaseId()}/query`,
        {
          method: "POST",
          signal: AbortSignal.timeout(30_000),
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

/** A marker is committed only after every object under this asset media prefix is uploaded. */
export const mediaCompletionMarkerKey = (assetId: string) => `media/${assetId}/.complete`;

/** Derives the completion marker beside the manifest/image object without trusting it as complete. */
export const mediaCompletionMarkerForMediaKey = (mediaKey: string) => {
  const keyDir = r2KeyDir(mediaKey);
  if (keyDir === "") throw new Error("media key must include an R2 directory");
  return `${keyDir}.complete`;
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
      const key = keyPrefix === "" ? entry.name : `${keyPrefix}/${entry.name}`;
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
          try: () => client.write(key, Bun.file(localPath), { type: mediaContentType(key) }),
          catch: (cause) => new ProdSyncError({ operation: "r2.write", cause }),
        }),
      { concurrency: uploadConcurrency, discard: true },
    );
  }).pipe(wrapProdError("uploadDir"));

const uploadAssetMedia = (mediaKey: string, localMediaDir: string) =>
  Effect.gen(function* () {
    const keyDir = r2KeyDir(mediaKey);
    if (keyDir === "")
      return yield* new ProdSyncError({
        operation: "uploadMedia",
        cause: new Error("media key must include an R2 directory"),
      });
    yield* uploadDir(localMediaDir, keyDir.slice(0, -1));
    // This is deliberately last: a missing marker makes an interrupted upload retryable.
    yield* Effect.tryPromise({
      try: () => r2().write(`${keyDir}.complete`, ""),
      catch: (cause) => new ProdSyncError({ operation: "r2.writeCompletionMarker", cause }),
    });
  }).pipe(wrapProdError("uploadMedia"));

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

/** Builds one atomic D1 replacement for an asset's chapters, binding every insert to the target. */
export const chapterReplacementStatements = (
  assetId: string,
  chapters: ReadonlyArray<Chapter>,
): ReadonlyArray<D1Statement> => [
  { sql: "DELETE FROM chapters WHERE asset_id = ?", params: [assetId] },
  ...chapters.map((chapter) => ({
    sql: "INSERT INTO chapters (id, asset_id, title, start_sec, sort_order) VALUES (?, ?, ?, ?, ?)",
    params: [chapter.id, assetId, chapter.title, chapter.startSec, chapter.sortOrder],
  })),
];

const replaceChapters = (assetId: string, chapters: ReadonlyArray<Chapter>) =>
  d1Batch(chapterReplacementStatements(assetId, chapters));

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

const removeR2Prefix = (mediaKey: string) =>
  Effect.gen(function* () {
    if (isAbsoluteHttpUrl(mediaKey)) return;
    const prefix = r2KeyDir(mediaKey);
    if (prefix === "")
      return yield* new ProdSyncError({
        operation: "removeMedia",
        cause: new Error("media key must include an R2 directory"),
      });
    const client = r2();
    const keys = yield* listPrefixKeys(prefix);
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

const assetStatement = (asset: Asset): D1Statement => ({
  sql: `INSERT INTO assets (id, slug, kind, title, description, poster_key, media_key, duration_sec, width, height, password_hash, project_id, sort_order, created_at, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, kind=excluded.kind, title=excluded.title, description=excluded.description, poster_key=excluded.poster_key, media_key=excluded.media_key, duration_sec=excluded.duration_sec, width=excluded.width, height=excluded.height, password_hash=excluded.password_hash, project_id=excluded.project_id, sort_order=excluded.sort_order, published_at=excluded.published_at, updated_at=excluded.updated_at`,
  params: [
    asset.id,
    asset.slug,
    asset.kind,
    asset.title,
    asset.description,
    asset.posterKey,
    asset.mediaKey,
    asset.durationSec,
    asset.width,
    asset.height,
    asset.passwordHash,
    asset.projectId,
    asset.sortOrder,
    asset.createdAt,
    asset.publishedAt,
    asset.updatedAt,
  ],
});

/** Deterministic full project-catalog snapshot; direct asset rows are never deleted. */
export const projectSnapshotStatements = (
  projects: ReadonlyArray<ProjectAggregate>,
  chaptersByAsset: ReadonlyMap<string, ReadonlyArray<Chapter>>,
  publishedAt: number,
): ReadonlyArray<D1Statement> => [
  { sql: "UPDATE assets SET project_id = NULL, sort_order = NULL", params: [] },
  { sql: "DELETE FROM projects", params: [] },
  ...projects.flatMap(({ project, assets }) => [
    {
      sql: "INSERT INTO projects (id, slug, title, description, password_hash, created_at, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        project.id,
        project.slug,
        project.title,
        project.description,
        project.passwordHash,
        project.createdAt,
        publishedAt,
        project.updatedAt,
      ],
    },
    ...assets.flatMap((asset, index) => {
      const published = new Asset({
        ...asset,
        projectId: project.id,
        sortOrder: index,
        publishedAt,
      });
      const chapters = chaptersByAsset.get(asset.id) ?? [];
      return [
        assetStatement(published),
        { sql: "DELETE FROM chapters WHERE asset_id = ?", params: [asset.id] },
        ...chapters.map((chapter) => ({
          sql: "INSERT INTO chapters (id, asset_id, title, start_sec, sort_order) VALUES (?, ?, ?, ?, ?)",
          params: [chapter.id, asset.id, chapter.title, chapter.startSec, chapter.sortOrder],
        })),
      ];
    }),
  ]),
];

export interface ProjectCatalogSnapshot {
  readonly projects: ReadonlyArray<ProjectAggregate>;
  readonly chaptersByAsset: ReadonlyMap<string, ReadonlyArray<Chapter>>;
  readonly publishedAt: number;
}

export interface ProdSyncService {
  readonly replaceProjectCatalog: (
    snapshot: ProjectCatalogSnapshot,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly removeProject: (projectId: ProjectId) => Effect.Effect<void, ProdSyncError>;
  readonly uploadMedia: (
    mediaKey: string,
    localMediaDir: string,
  ) => Effect.Effect<void, ProdSyncError>;
  readonly invalidateMedia: (mediaKey: string) => Effect.Effect<void, ProdSyncError>;
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
  readonly removeMedia: (mediaKey: string) => Effect.Effect<void, ProdSyncError>;
  readonly unpublish: (assetId: string) => Effect.Effect<void, ProdSyncError>;
  readonly removeFromProd: (
    assetId: string,
    mediaKey: string,
  ) => Effect.Effect<void, ProdSyncError>;
}

export class ProdSync extends Context.Service<ProdSync, ProdSyncService>()("admin/ProdSync") {
  static readonly layer: Layer.Layer<ProdSync> = Layer.succeed(
    ProdSync,
    ProdSync.of({
      replaceProjectCatalog: (snapshot) =>
        d1Batch(
          projectSnapshotStatements(
            snapshot.projects,
            snapshot.chaptersByAsset,
            snapshot.publishedAt,
          ),
        ),
      removeProject: (projectId) =>
        d1Batch([
          {
            sql: "UPDATE assets SET project_id = NULL, sort_order = NULL WHERE project_id = ?",
            params: [projectId],
          },
          { sql: "DELETE FROM projects WHERE id = ?", params: [projectId] },
        ]),
      uploadMedia: uploadAssetMedia,
      invalidateMedia: (mediaKey) =>
        Effect.tryPromise({
          try: () => r2().delete(mediaCompletionMarkerForMediaKey(mediaKey)),
          catch: (cause) =>
            new ProdSyncError({ operation: "r2.invalidateCompletionMarker", cause }),
        }).pipe(wrapProdError("invalidateMedia")),
      mediaExists: (mediaKey) =>
        Effect.tryPromise({
          // Existing objects without this marker are treated as incomplete and repaired on retry.
          try: () => r2().exists(mediaCompletionMarkerForMediaKey(mediaKey)),
          catch: (cause) => new ProdSyncError({ operation: "mediaExists", cause }),
        }).pipe(wrapProdError("mediaExists")),
      syncMetadata: (video, chapters) =>
        Effect.gen(function* () {
          yield* upsertAsset(video);
          yield* replaceChapters(video.id, chapters);
        }).pipe(wrapProdError("syncMetadata")),
      pushToProd: (video, chapters, localMediaDir) =>
        Effect.gen(function* () {
          yield* uploadAssetMedia(video.mediaKey, localMediaDir);
          yield* upsertAsset(video);
          yield* replaceChapters(video.id, chapters);
        }).pipe(wrapProdError("pushToProd")),
      removeMedia: (mediaKey) => removeR2Prefix(mediaKey),
      unpublish: (assetId) => unpublishAsset(assetId),
      removeFromProd: (assetId, mediaKey) =>
        Effect.gen(function* () {
          yield* removeR2Prefix(mediaKey);
          yield* deleteAssetRow(assetId);
        }),
    }),
  );
}

/** The orchestration boundary for direct assets and complete project catalog publication. */
export class Publisher extends Context.Service<
  Publisher,
  {
    readonly publishAsset: (
      assetId: string,
    ) => Effect.Effect<
      Asset,
      | PersistenceError
      | ProdSyncError
      | AssetPublicationValidationError
      | AssetNotFoundError
      | InvalidMediaShapeError
      | SlugAlreadyExistsError
    >;
    readonly publishProject: (
      projectId: ProjectId,
    ) => Effect.Effect<
      void,
      PersistenceError | ProdSyncError | ProjectPublicationValidationError | ProjectNotFoundError
    >;
    /** Removes only remote project publication, retaining local membership and direct asset state. */
    readonly unpublishProject: (
      projectId: ProjectId,
    ) => Effect.Effect<void, PersistenceError | ProdSyncError | ProjectNotFoundError>;
    readonly removeProject: (projectId: ProjectId) => Effect.Effect<void, ProdSyncError>;
  }
>()("admin/Publisher") {
  static readonly layer = Layer.effect(
    Publisher,
    Effect.gen(function* () {
      const assets = yield* AssetRepository;
      const projects = yield* ProjectRepository;
      const storage = yield* Storage;
      const sync = yield* ProdSync;
      const mediaShapeError = (asset: Asset): InvalidMediaShapeError | undefined => {
        if (
          asset.kind === "image" &&
          (asset.durationSec !== 0 ||
            asset.width === null ||
            asset.width <= 0 ||
            asset.height === null ||
            asset.height <= 0)
        )
          return new InvalidMediaShapeError({
            assetId: asset.id,
            kind: asset.kind,
            reason: "imageRequiresZeroDurationAndPositiveDimensions",
          });
        if (
          asset.kind === "markdown" &&
          (asset.durationSec !== 0 || asset.width !== null || asset.height !== null)
        )
          return new InvalidMediaShapeError({
            assetId: asset.id,
            kind: asset.kind,
            reason: "markdownRequiresZeroDurationAndNullDimensions",
          });
        if (
          asset.kind !== "image" &&
          asset.kind !== "markdown" &&
          (asset.width !== null || asset.height !== null)
        )
          return new InvalidMediaShapeError({
            assetId: asset.id,
            kind: asset.kind,
            reason: "timedAssetsRequireNullDimensions",
          });
        return undefined;
      };
      const validate = (aggregate: ProjectAggregate) => {
        if (aggregate.assets.length === 0)
          return new ProjectPublicationValidationError({
            projectId: aggregate.project.id,
            reason: "emptyProject",
          });
        for (const asset of aggregate.assets) {
          if (!asset.mediaKey)
            return new ProjectPublicationValidationError({
              projectId: aggregate.project.id,
              reason: "missingMediaKey",
            });
          if (mediaShapeError(asset) !== undefined)
            return new ProjectPublicationValidationError({
              projectId: aggregate.project.id,
              reason: "invalidMediaShape",
            });
          if (aggregate.project.passwordHash !== null && isAbsoluteHttpUrl(asset.mediaKey))
            return new ProjectPublicationValidationError({
              projectId: aggregate.project.id,
              reason: "absoluteMediaKeyInProtectedProject",
            });
        }
        return undefined;
      };
      const publishProject = Effect.fn("Publisher.publishProject")(function* (
        projectId: ProjectId,
      ) {
        const target = yield* projects.get(projectId);
        if (Option.isNone(target)) return yield* new ProjectNotFoundError({ id: projectId });
        const summaries = yield* projects.list();
        const aggregates = yield* Effect.all(
          summaries
            .filter((project) => project.publishedAt !== null && project.id !== projectId)
            .map((project) => projects.get(project.id)),
        );
        const included = [
          target.value,
          ...aggregates.flatMap((project) => (Option.isSome(project) ? [project.value] : [])),
        ];
        for (const aggregate of included) {
          const error = validate(aggregate);
          if (error) return yield* error;
        }
        const chapters = new Map<string, ReadonlyArray<Chapter>>();
        for (const aggregate of included)
          for (const asset of aggregate.assets) {
            chapters.set(asset.id, yield* assets.listChapters(asset.id));
            if (!isAbsoluteHttpUrl(asset.mediaKey) && !(yield* sync.mediaExists(asset.mediaKey)))
              yield* sync.uploadMedia(asset.mediaKey, storage.assetDir(asset.id));
          }
        const publishedAt = Date.now();
        yield* sync.replaceProjectCatalog({
          projects: included,
          chaptersByAsset: chapters,
          publishedAt,
        });
        // Only the successful remote snapshot changes local publication state.
        yield* projects.markPublished(included, publishedAt);
      });
      return Publisher.of({
        publishAsset: (assetId) =>
          Effect.gen(function* () {
            const found = yield* assets.findById(AssetId.make(assetId));
            if (Option.isNone(found)) return yield* new AssetNotFoundError({ id: assetId });
            const asset = found.value;
            if (!asset.mediaKey)
              return yield* new AssetPublicationValidationError({
                assetId,
                reason: "missingMediaKey",
              });
            const shapeError = mediaShapeError(asset);
            if (shapeError) return yield* shapeError;
            const published = new Asset({ ...asset, publishedAt: Date.now() });
            if (
              !isAbsoluteHttpUrl(published.mediaKey) &&
              !(yield* sync.mediaExists(published.mediaKey))
            )
              yield* sync.uploadMedia(published.mediaKey, storage.assetDir(published.id));
            yield* sync.syncMetadata(published, yield* assets.listChapters(published.id));
            return yield* assets.update(published);
          }),
        publishProject,
        unpublishProject: (projectId) =>
          Effect.gen(function* () {
            const found = yield* projects.get(projectId);
            if (Option.isNone(found)) return yield* new ProjectNotFoundError({ id: projectId });
            yield* sync.removeProject(projectId);
            // Local members/assets/media and their direct publication intentionally remain untouched.
            yield* projects.clearPublishedAt(projectId);
          }),
        removeProject: (projectId) => sync.removeProject(projectId),
      });
    }),
  );
}

/** Uploads local media beneath the directory containing `mediaKey`; root keys are rejected. */
export const uploadMedia = (mediaKey: string, localMediaDir: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.uploadMedia(mediaKey, localMediaDir);
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

export const removeMedia = (mediaKey: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.removeMedia(mediaKey);
  }).pipe(Effect.provide(ProdSync.layer));

export const unpublish = (assetId: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.unpublish(assetId);
  }).pipe(Effect.provide(ProdSync.layer));

export const removeFromProd = (assetId: string, mediaKey: string) =>
  Effect.gen(function* () {
    const sync = yield* ProdSync;
    return yield* sync.removeFromProd(assetId, mediaKey);
  }).pipe(Effect.provide(ProdSync.layer));

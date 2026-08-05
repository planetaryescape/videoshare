import { Array, Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Chapter, ChapterId, AssetId } from "./Asset.ts";
import type { Asset } from "./Asset.ts";
import { assetFromRow, type AssetRow } from "./AssetRow.ts";
import {
  ImageChaptersNotAllowedError,
  InvalidMediaShapeError,
  PersistenceError,
  SlugAlreadyExistsError,
} from "./AssetErrors.ts";

type ExpectedAssetRepositoryError =
  | PersistenceError
  | SlugAlreadyExistsError
  | ImageChaptersNotAllowedError
  | InvalidMediaShapeError;

const isExpectedAssetRepositoryError = (cause: unknown): cause is ExpectedAssetRepositoryError =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  (cause._tag === "PersistenceError" ||
    cause._tag === "SlugAlreadyExistsError" ||
    cause._tag === "ImageChaptersNotAllowedError" ||
    cause._tag === "InvalidMediaShapeError");

const wrapSqlError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.mapError(effect, (cause) =>
      isExpectedAssetRepositoryError(cause) ? cause : new PersistenceError({ operation, cause }),
    );

interface ChapterRow {
  readonly id: string;
  readonly asset_id: string;
  readonly title: string;
  readonly start_sec: number;
  readonly sort_order: number;
}

const toAsset = (row: AssetRow): Effect.Effect<Asset, PersistenceError> =>
  Effect.try({
    try: () => assetFromRow(row),
    catch: (cause) => new PersistenceError({ operation: "decodeAsset", cause }),
  });

const toChapter = (row: ChapterRow): Effect.Effect<Chapter, PersistenceError> =>
  Effect.try({
    try: () =>
      new Chapter({
        id: ChapterId.make(row.id),
        assetId: AssetId.make(row.asset_id),
        title: row.title,
        startSec: row.start_sec,
        sortOrder: row.sort_order,
      }),
    catch: (cause) => new PersistenceError({ operation: "decodeChapter", cause }),
  });

export class AssetRepository extends Context.Service<
  AssetRepository,
  {
    findById(id: AssetId): Effect.Effect<Option.Option<Asset>, PersistenceError>;
    findBySlug(slug: string): Effect.Effect<Option.Option<Asset>, PersistenceError>;
    list(): Effect.Effect<ReadonlyArray<Asset>, PersistenceError>;
    create(
      asset: Asset,
    ): Effect.Effect<Asset, PersistenceError | SlugAlreadyExistsError | InvalidMediaShapeError>;
    /** Updates metadata and publication state only; media transitions use replaceMedia. */
    update(asset: Asset): Effect.Effect<Asset, PersistenceError | SlugAlreadyExistsError>;
    /** Replaces an asset's media and clears timed-only chapters as one catalog operation. */
    replaceMedia(
      asset: Asset,
    ): Effect.Effect<Asset, PersistenceError | SlugAlreadyExistsError | InvalidMediaShapeError>;
    delete(id: AssetId, updatedAt: number): Effect.Effect<void, PersistenceError>;
    listChapters(assetId: AssetId): Effect.Effect<ReadonlyArray<Chapter>, PersistenceError>;
    replaceChapters(
      assetId: AssetId,
      chapters: ReadonlyArray<Chapter>,
    ): Effect.Effect<void, PersistenceError | ImageChaptersNotAllowedError>;
  }
>()("videoshare/AssetRepository") {
  static readonly layerNoDeps: Layer.Layer<AssetRepository, never, SqlClient.SqlClient> =
    Layer.effect(
      AssetRepository,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const findById = Effect.fn("AssetRepository.findById")(function* (id: AssetId) {
          const rows = yield* sql<AssetRow>`SELECT * FROM assets WHERE id = ${id}`;
          const head = Array.head(rows);
          if (Option.isNone(head)) return Option.none<Asset>();
          return Option.some(yield* toAsset(head.value));
        }, wrapSqlError("findById"));

        const findBySlug = Effect.fn("AssetRepository.findBySlug")(function* (slug: string) {
          const rows = yield* sql<AssetRow>`SELECT * FROM assets WHERE slug = ${slug}`;
          const head = Array.head(rows);
          if (Option.isNone(head)) return Option.none<Asset>();
          return Option.some(yield* toAsset(head.value));
        }, wrapSqlError("findBySlug"));

        const list = Effect.fn("AssetRepository.list")(function* () {
          const rows = yield* sql<AssetRow>`SELECT * FROM assets ORDER BY created_at DESC`;
          return yield* Effect.all(rows.map(toAsset));
        }, wrapSqlError("list"));

        const mediaShapeError = (asset: Asset): InvalidMediaShapeError | undefined => {
          if (
            asset.kind === "image" &&
            (asset.durationSec !== 0 ||
              asset.width === null ||
              asset.width <= 0 ||
              asset.height === null ||
              asset.height <= 0)
          ) {
            return new InvalidMediaShapeError({
              assetId: asset.id,
              kind: asset.kind,
              reason: "imageRequiresZeroDurationAndPositiveDimensions",
            });
          }
          if (asset.kind !== "image" && (asset.width !== null || asset.height !== null)) {
            return new InvalidMediaShapeError({
              assetId: asset.id,
              kind: asset.kind,
              reason: "timedAssetsRequireNullDimensions",
            });
          }
          return undefined;
        };

        const create = Effect.fn("AssetRepository.create")(function* (asset: Asset) {
          const invalidShape = mediaShapeError(asset);
          if (invalidShape) return yield* invalidShape;
          const existing = yield* sql<{
            readonly c: number;
          }>`SELECT COUNT(*) AS c FROM assets WHERE slug = ${asset.slug}`;
          if ((existing[0]?.c ?? 0) > 0) {
            return yield* new SlugAlreadyExistsError({ slug: asset.slug });
          }
          yield* sql`
            INSERT INTO assets (id, slug, kind, title, description, poster_key, media_key, duration_sec, width, height, password_hash, project_id, sort_order, created_at, published_at, updated_at)
            VALUES (${asset.id}, ${asset.slug}, ${asset.kind}, ${asset.title}, ${asset.description}, ${asset.posterKey}, ${asset.mediaKey}, ${asset.durationSec}, ${asset.width}, ${asset.height}, ${asset.passwordHash}, ${asset.projectId}, ${asset.sortOrder}, ${asset.createdAt}, ${asset.publishedAt}, ${asset.updatedAt})
          `;
          return asset;
        }, wrapSqlError("create"));

        const updateMetadata = (asset: Asset) =>
          sql`
            UPDATE assets SET
              slug = ${asset.slug},
              title = ${asset.title},
              description = ${asset.description},
              poster_key = ${asset.posterKey},
              password_hash = ${asset.passwordHash},
              published_at = ${asset.publishedAt},
              updated_at = ${asset.updatedAt}
            WHERE id = ${asset.id}
          `;

        const updateMedia = (asset: Asset) =>
          sql`
            UPDATE assets SET
              kind = ${asset.kind},
              media_key = ${asset.mediaKey},
              duration_sec = ${asset.durationSec},
              width = ${asset.width},
              height = ${asset.height}
            WHERE id = ${asset.id}
          `;

        const assertSlugAvailable = (asset: Asset) =>
          Effect.gen(function* () {
            const existing = yield* sql<{ readonly id: string }>`
              SELECT id FROM assets WHERE slug = ${asset.slug} AND id != ${asset.id}
            `;
            if (existing.length > 0) return yield* new SlugAlreadyExistsError({ slug: asset.slug });
          });

        const update = Effect.fn("AssetRepository.update")(function* (asset: Asset) {
          yield* assertSlugAvailable(asset);
          yield* updateMetadata(asset);
          return asset;
        }, wrapSqlError("update"));

        const replaceMedia = Effect.fn("AssetRepository.replaceMedia")(function* (asset: Asset) {
          const invalidShape = mediaShapeError(asset);
          if (invalidShape) return yield* invalidShape;
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* assertSlugAvailable(asset);
              yield* updateMetadata(asset);
              yield* updateMedia(asset);
              if (asset.kind === "image") {
                yield* sql`DELETE FROM chapters WHERE asset_id = ${asset.id}`;
              }
            }),
          );
          return asset;
        }, wrapSqlError("replaceMedia"));

        const del = Effect.fn("AssetRepository.delete")(function* (id: AssetId, updatedAt: number) {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM chapters WHERE asset_id = ${id}`;
              const deleted = yield* sql<{ readonly project_id: string | null }>`
                DELETE FROM assets WHERE id = ${id} RETURNING project_id
              `;
              const projectId = deleted[0]?.project_id;
              if (projectId === undefined || projectId === null) return;
              // Nonnegative positions map uniquely to negative values, leaving compacted positions free.
              yield* sql`UPDATE assets SET sort_order = -sort_order - 1 WHERE project_id = ${projectId}`;
              const members = yield* sql<{ readonly id: string }>`
                SELECT id FROM assets WHERE project_id = ${projectId} ORDER BY sort_order DESC
              `;
              for (const [index, member] of members.entries())
                yield* sql`UPDATE assets SET sort_order = ${index} WHERE id = ${member.id}`;
              yield* sql`UPDATE projects SET updated_at = ${updatedAt} WHERE id = ${projectId}`;
            }),
          );
        }, wrapSqlError("delete"));

        const listChapters = Effect.fn("AssetRepository.listChapters")(function* (
          assetId: AssetId,
        ) {
          const rows =
            yield* sql<ChapterRow>`SELECT * FROM chapters WHERE asset_id = ${assetId} ORDER BY sort_order ASC`;
          return yield* Effect.all(rows.map(toChapter));
        }, wrapSqlError("listChapters"));

        const replaceChapters = Effect.fn("AssetRepository.replaceChapters")(function* (
          assetId: AssetId,
          chapters: ReadonlyArray<Chapter>,
        ) {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              if (chapters.length > 0) {
                const assets = yield* sql<{
                  readonly kind: string;
                }>`SELECT kind FROM assets WHERE id = ${assetId}`;
                if (assets[0]?.kind === "image") {
                  return yield* new ImageChaptersNotAllowedError({
                    assetId,
                    chapterCount: chapters.length,
                  });
                }
              }
              yield* sql`DELETE FROM chapters WHERE asset_id = ${assetId}`;
              for (const ch of chapters) {
                yield* sql`
                  INSERT INTO chapters (id, asset_id, title, start_sec, sort_order)
                  VALUES (${ch.id}, ${assetId}, ${ch.title}, ${ch.startSec}, ${ch.sortOrder})
                `;
              }
            }),
          );
        }, wrapSqlError("replaceChapters"));

        return AssetRepository.of({
          findById,
          findBySlug,
          list,
          create,
          update,
          replaceMedia,
          delete: del,
          listChapters,
          replaceChapters,
        });
      }),
    );
}

import { Array, Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Chapter, ChapterId, Kind, Slug, Asset, AssetId } from "./Asset.ts";
import { PersistenceError, SlugAlreadyExistsError } from "./AssetErrors.ts";

const wrapSqlError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> =>
    Effect.mapError(effect, (cause) => new PersistenceError({ operation, cause }));

interface AssetRow {
  readonly id: string;
  readonly slug: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string | null;
  readonly poster_key: string | null;
  readonly media_key: string;
  readonly duration_sec: number;
  readonly password_hash: string | null;
  readonly created_at: number;
  readonly published_at: number | null;
  readonly updated_at: number | null;
}

interface ChapterRow {
  readonly id: string;
  readonly asset_id: string;
  readonly title: string;
  readonly start_sec: number;
  readonly sort_order: number;
}

const toAsset = (row: AssetRow): Effect.Effect<Asset, PersistenceError> =>
  Effect.try({
    try: () =>
      new Asset({
        id: AssetId.make(row.id),
        slug: Slug.make(row.slug),
        kind: Schema.decodeUnknownSync(Kind)(row.kind),
        title: row.title,
        description: row.description,
        posterKey: row.poster_key,
        mediaKey: row.media_key,
        durationSec: row.duration_sec,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
      }),
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
    create(asset: Asset): Effect.Effect<Asset, PersistenceError | SlugAlreadyExistsError>;
    update(asset: Asset): Effect.Effect<Asset, PersistenceError>;
    delete(id: AssetId): Effect.Effect<void, PersistenceError>;
    listChapters(assetId: AssetId): Effect.Effect<ReadonlyArray<Chapter>, PersistenceError>;
    replaceChapters(
      assetId: AssetId,
      chapters: ReadonlyArray<Chapter>,
    ): Effect.Effect<void, PersistenceError>;
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

        const create = Effect.fn("AssetRepository.create")(function* (asset: Asset) {
          const existing = yield* sql<{
            readonly c: number;
          }>`SELECT COUNT(*) AS c FROM assets WHERE slug = ${asset.slug}`;
          if ((existing[0]?.c ?? 0) > 0) {
            return yield* new SlugAlreadyExistsError({ slug: asset.slug });
          }
          yield* sql`
            INSERT INTO assets (id, slug, kind, title, description, poster_key, media_key, duration_sec, password_hash, created_at, published_at, updated_at)
            VALUES (${asset.id}, ${asset.slug}, ${asset.kind}, ${asset.title}, ${asset.description}, ${asset.posterKey}, ${asset.mediaKey}, ${asset.durationSec}, ${asset.passwordHash}, ${asset.createdAt}, ${asset.publishedAt}, ${asset.updatedAt})
          `;
          return asset;
        }, wrapSqlError("create"));

        const update = Effect.fn("AssetRepository.update")(function* (asset: Asset) {
          yield* sql`
            UPDATE assets SET
              slug = ${asset.slug},
              kind = ${asset.kind},
              title = ${asset.title},
              description = ${asset.description},
              poster_key = ${asset.posterKey},
              media_key = ${asset.mediaKey},
              duration_sec = ${asset.durationSec},
              password_hash = ${asset.passwordHash},
              published_at = ${asset.publishedAt},
              updated_at = ${asset.updatedAt}
            WHERE id = ${asset.id}
          `;
          return asset;
        }, wrapSqlError("update"));

        const del = Effect.fn("AssetRepository.delete")(function* (id: AssetId) {
          yield* sql`DELETE FROM chapters WHERE asset_id = ${id}`;
          yield* sql`DELETE FROM assets WHERE id = ${id}`;
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
          yield* sql`DELETE FROM chapters WHERE asset_id = ${assetId}`;
          for (const ch of chapters) {
            yield* sql`
              INSERT INTO chapters (id, asset_id, title, start_sec, sort_order)
              VALUES (${ch.id}, ${assetId}, ${ch.title}, ${ch.startSec}, ${ch.sortOrder})
            `;
          }
        }, wrapSqlError("replaceChapters"));

        return AssetRepository.of({
          findById,
          findBySlug,
          list,
          create,
          update,
          delete: del,
          listChapters,
          replaceChapters,
        });
      }),
    );
}

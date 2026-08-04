import { Array, Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Asset, AssetId, Chapter, ChapterId, Kind, Slug } from "./Asset.ts";
import { PersistenceError } from "./AssetErrors.ts";

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

export interface AssetPageView {
  readonly asset: Asset;
  readonly chapters: ReadonlyArray<Chapter>;
}

const wrapSqlError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> =>
    Effect.mapError(effect, (cause) => new PersistenceError({ operation, cause }));

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

/** Reads published viewer projections without exposing editing persistence behavior. */
export class ViewerCatalog extends Context.Service<
  ViewerCatalog,
  {
    findAssetPage(slug: string): Effect.Effect<Option.Option<AssetPageView>, PersistenceError>;
    findAssetMedia(slug: string): Effect.Effect<Option.Option<Asset>, PersistenceError>;
  }
>()("videoshare/ViewerCatalog") {
  static readonly layerNoDeps: Layer.Layer<ViewerCatalog, never, SqlClient.SqlClient> =
    Layer.effect(
      ViewerCatalog,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const findAssetMedia = Effect.fn("ViewerCatalog.findAssetMedia")(function* (slug: string) {
          const rows = yield* sql<AssetRow>`
          SELECT id, slug, kind, title, description, poster_key, media_key, duration_sec,
                 password_hash, created_at, published_at, updated_at
          FROM assets
          WHERE slug = ${slug} AND published_at IS NOT NULL
        `;
          const head = Array.head(rows);
          if (Option.isNone(head)) return Option.none<Asset>();
          return Option.some(yield* toAsset(head.value));
        }, wrapSqlError("findAssetMedia"));

        const findAssetPage = Effect.fn("ViewerCatalog.findAssetPage")(function* (slug: string) {
          const assetOption = yield* findAssetMedia(slug);
          if (Option.isNone(assetOption)) return Option.none<AssetPageView>();
          const asset = assetOption.value;
          const rows =
            yield* sql<ChapterRow>`SELECT id, asset_id, title, start_sec, sort_order FROM chapters WHERE asset_id = ${asset.id} ORDER BY sort_order ASC`;
          const chapters = yield* Effect.all(rows.map(toChapter));
          return Option.some({ asset, chapters });
        }, wrapSqlError("findAssetPage"));

        return ViewerCatalog.of({ findAssetPage, findAssetMedia });
      }),
    );
}

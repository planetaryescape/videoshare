import { Array, Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { AssetId, Chapter, ChapterId } from "./Asset.ts";
import type { Asset } from "./Asset.ts";
import { assetFromRow, type AssetRow } from "./AssetRow.ts";
import { PersistenceError } from "./AssetErrors.ts";

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
          SELECT id, slug, kind, title, description, poster_key, media_key, duration_sec, width, height,
                 password_hash, project_id, sort_order, created_at, published_at, updated_at
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

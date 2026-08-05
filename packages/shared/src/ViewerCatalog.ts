import { Array, Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { AssetId, Chapter, ChapterId, ProjectId, Slug } from "./Asset.ts";
import type { Asset } from "./Asset.ts";
import { assetFromRow, type AssetRow } from "./AssetRow.ts";
import { Project } from "./Project.ts";
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

/** Project page deliberately carries no chapters: media playback is a separate hot path. */
export interface ProjectPageView {
  readonly project: Project;
  readonly assets: ReadonlyArray<Asset>;
  readonly selected: Asset;
}

export interface ProjectMediaView {
  readonly project: Project;
  readonly asset: Asset;
}

interface ProjectRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly password_hash: string | null;
  readonly created_at: number;
  readonly published_at: number | null;
  readonly updated_at: number | null;
}

/** Explicit projection of the aliased project-media join; it is not an intersection of row DTOs. */
interface ProjectMediaRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly password_hash: string | null;
  readonly created_at: number;
  readonly published_at: number | null;
  readonly updated_at: number | null;
  readonly asset_id: string;
  readonly asset_slug: string;
  readonly asset_kind: string;
  readonly asset_title: string;
  readonly asset_description: string | null;
  readonly asset_poster_key: string | null;
  readonly asset_media_key: string;
  readonly asset_duration_sec: number;
  readonly asset_width: number | null;
  readonly asset_height: number | null;
  readonly asset_password_hash: string | null;
  readonly asset_project_id: string | null;
  readonly asset_sort_order: number | null;
  readonly asset_created_at: number;
  readonly asset_published_at: number | null;
  readonly asset_updated_at: number | null;
}

const toProject = (row: ProjectRow): Effect.Effect<Project, PersistenceError> =>
  Effect.try({
    try: () =>
      new Project({
        id: ProjectId.make(row.id),
        slug: Slug.make(row.slug),
        title: row.title,
        description: row.description,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
      }),
    catch: (cause) => new PersistenceError({ operation: "decodeProject", cause }),
  });

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
    findProjectPage(
      projectSlug: string,
      assetSlug: string | null,
    ): Effect.Effect<Option.Option<ProjectPageView>, PersistenceError>;
    findProjectMedia(
      projectSlug: string,
      assetSlug: string,
    ): Effect.Effect<Option.Option<ProjectMediaView>, PersistenceError>;
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
          LIMIT 1
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

        const findProjectPage = Effect.fn("ViewerCatalog.findProjectPage")(function* (
          projectSlug: string,
          assetSlug: string | null,
        ) {
          const projects = yield* sql<ProjectRow>`
            SELECT id, slug, title, description, password_hash, created_at, published_at, updated_at
            FROM projects
            WHERE slug = ${projectSlug} AND published_at IS NOT NULL
            LIMIT 1
          `;
          const projectRow = Array.head(projects);
          if (Option.isNone(projectRow)) return Option.none<ProjectPageView>();
          const project = yield* toProject(projectRow.value);
          const rows =
            yield* sql<AssetRow>`SELECT a.id, a.slug, a.kind, a.title, a.description, a.poster_key, a.media_key, a.duration_sec, a.width, a.height, a.password_hash, a.project_id, a.sort_order, a.created_at, a.published_at, a.updated_at FROM assets a WHERE a.project_id = ${project.id} AND a.published_at IS NOT NULL ORDER BY a.sort_order ASC`;
          const assets = yield* Effect.all(rows.map(toAsset));
          const selected =
            assetSlug === null ? assets[0] : assets.find((asset) => asset.slug === assetSlug);
          return selected === undefined
            ? Option.none<ProjectPageView>()
            : Option.some({ project, assets, selected });
        }, wrapSqlError("findProjectPage"));

        const findProjectMedia = Effect.fn("ViewerCatalog.findProjectMedia")(function* (
          projectSlug: string,
          assetSlug: string,
        ) {
          const rows = yield* sql<ProjectMediaRow>`
            SELECT p.id, p.slug, p.title, p.description, p.password_hash, p.created_at, p.published_at,
                   p.updated_at, a.id AS asset_id, a.slug AS asset_slug, a.kind AS asset_kind,
                   a.title AS asset_title, a.description AS asset_description,
                   a.poster_key AS asset_poster_key, a.media_key AS asset_media_key,
                   a.duration_sec AS asset_duration_sec, a.width AS asset_width,
                   a.height AS asset_height, a.password_hash AS asset_password_hash,
                   a.project_id AS asset_project_id, a.sort_order AS asset_sort_order,
                   a.created_at AS asset_created_at, a.published_at AS asset_published_at,
                   a.updated_at AS asset_updated_at
            FROM projects p
            JOIN assets a ON a.project_id = p.id
            WHERE p.slug = ${projectSlug} AND p.published_at IS NOT NULL
              AND a.slug = ${assetSlug} AND a.published_at IS NOT NULL
            LIMIT 1
          `;
          const row = rows[0];
          if (!row) return Option.none<ProjectMediaView>();
          const asset = yield* toAsset({
            id: row.asset_id,
            slug: row.asset_slug,
            kind: row.asset_kind,
            title: row.asset_title,
            description: row.asset_description,
            poster_key: row.asset_poster_key,
            media_key: row.asset_media_key,
            duration_sec: row.asset_duration_sec,
            width: row.asset_width,
            height: row.asset_height,
            password_hash: row.asset_password_hash,
            project_id: row.asset_project_id,
            sort_order: row.asset_sort_order,
            created_at: row.asset_created_at,
            published_at: row.asset_published_at,
            updated_at: row.asset_updated_at,
          });
          return Option.some({ project: yield* toProject(row), asset });
        }, wrapSqlError("findProjectMedia"));

        return ViewerCatalog.of({
          findAssetPage,
          findAssetMedia,
          findProjectPage,
          findProjectMedia,
        });
      }),
    );
}

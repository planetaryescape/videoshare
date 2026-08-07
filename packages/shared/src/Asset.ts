import { Schema } from "effect";

export const AssetId = Schema.String.pipe(Schema.brand("AssetId"));
export type AssetId = typeof AssetId.Type;

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const ChapterId = Schema.String.pipe(Schema.brand("ChapterId"));
export type ChapterId = typeof ChapterId.Type;

export const Slug = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("Slug"));
export type Slug = typeof Slug.Type;

/** Asset member routes reserve `summary` for the project-complete page. */
export const AssetSlug = Slug.check(
  Schema.makeFilter((slug) =>
    slug === "summary" ? "Asset slug `summary` is reserved" : undefined,
  ),
);

export const Kind = Schema.Literals(["video", "audio", "image", "markdown"]);
export type Kind = typeof Kind.Type;

export class Chapter extends Schema.Class<Chapter>("Chapter")({
  id: ChapterId,
  assetId: AssetId,
  title: Schema.String.check(Schema.isNonEmpty()),
  startSec: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  sortOrder: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

const AssetFields = Schema.Struct({
  id: AssetId,
  slug: AssetSlug,
  kind: Kind,
  title: Schema.String.check(Schema.isNonEmpty()),
  description: Schema.NullOr(Schema.String),
  posterKey: Schema.NullOr(Schema.String),
  mediaKey: Schema.String,
  durationSec: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  width: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  height: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  passwordHash: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(ProjectId),
  sortOrder: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  createdAt: Schema.Number,
  publishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.NullOr(Schema.Number),
}).check(
  Schema.makeFilter((asset) =>
    (asset.projectId === null) === (asset.sortOrder === null)
      ? undefined
      : "Asset projectId and sortOrder must either both be set or both be null",
  ),
);

export class Asset extends Schema.Class<Asset>("Asset")(AssetFields) {}

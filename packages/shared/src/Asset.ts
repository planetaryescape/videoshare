import { Schema } from "effect";

export const AssetId = Schema.String.pipe(Schema.brand("AssetId"));
export type AssetId = typeof AssetId.Type;

export const ChapterId = Schema.String.pipe(Schema.brand("ChapterId"));
export type ChapterId = typeof ChapterId.Type;

export const Slug = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("Slug"));
export type Slug = typeof Slug.Type;

export const Kind = Schema.Literals(["video", "audio"]);
export type Kind = typeof Kind.Type;

export class Chapter extends Schema.Class<Chapter>("Chapter")({
  id: ChapterId,
  assetId: AssetId,
  title: Schema.String.check(Schema.isNonEmpty()),
  startSec: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  sortOrder: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class Asset extends Schema.Class<Asset>("Asset")({
  id: AssetId,
  slug: Slug,
  kind: Kind,
  title: Schema.String.check(Schema.isNonEmpty()),
  description: Schema.NullOr(Schema.String),
  posterKey: Schema.NullOr(Schema.String),
  mediaKey: Schema.String,
  durationSec: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  passwordHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  publishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.NullOr(Schema.Number),
}) {}

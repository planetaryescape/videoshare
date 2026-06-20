import { Schema } from "effect";

export const VideoId = Schema.String.pipe(Schema.brand("VideoId"));
export type VideoId = typeof VideoId.Type;

export const ChapterId = Schema.String.pipe(Schema.brand("ChapterId"));
export type ChapterId = typeof ChapterId.Type;

export const Slug = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("Slug"));
export type Slug = typeof Slug.Type;

export class Chapter extends Schema.Class<Chapter>("Chapter")({
  id: ChapterId,
  videoId: VideoId,
  title: Schema.String.check(Schema.isNonEmpty()),
  startSec: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  sortOrder: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class Video extends Schema.Class<Video>("Video")({
  id: VideoId,
  slug: Slug,
  title: Schema.String.check(Schema.isNonEmpty()),
  description: Schema.NullOr(Schema.String),
  posterKey: Schema.NullOr(Schema.String),
  hlsKey: Schema.String,
  durationSec: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  passwordHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  publishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.NullOr(Schema.Number),
}) {}

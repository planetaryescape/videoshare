import { Schema } from "effect";
import { Chapter, Slug, Asset, AssetId } from "@videoshare/shared/Asset";

export const ChapterInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.String,
  startSec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ChapterInput = typeof ChapterInput.Type;

const NonBlankTitle = Schema.String.check(Schema.isMinLength(1));

export const CreateAssetRequest = Schema.Struct({
  title: NonBlankTitle,
  description: Schema.optional(Schema.String),
});
export type CreateAssetRequest = typeof CreateAssetRequest.Type;

export const UpdateAssetRequest = Schema.Struct({
  title: Schema.optional(NonBlankTitle),
  description: Schema.optional(Schema.String),
  chapters: Schema.optional(Schema.Array(ChapterInput)),
});
export type UpdateAssetRequest = typeof UpdateAssetRequest.Type;

export const AssetIdParam = Schema.Struct({
  id: Schema.String,
});

export const AssetWithChapters = Schema.Struct({
  video: Asset,
  chapters: Schema.Array(Chapter),
});
export type AssetWithChapters = typeof AssetWithChapters.Type;

export const AssetListResponse = Schema.Array(Asset);
export type AssetListResponse = typeof AssetListResponse.Type;

export const DeleteResponse = Schema.Struct({
  success: Schema.Boolean,
});
export type DeleteResponse = typeof DeleteResponse.Type;

export const SlugParam = Schema.Struct({
  slug: Slug,
});

export const AssetIdPath = Schema.Struct({
  id: AssetId,
});

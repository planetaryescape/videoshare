import { Schema } from "effect";
import { Chapter, Slug, AssetId, ProjectId } from "@videoshare/shared/Asset";
import { BrowserProjectAsset } from "../projects/contracts.ts";

export const ChapterInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.String,
  startSec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ChapterInput = typeof ChapterInput.Type;

const NonBlankTitle = Schema.String.check(Schema.isPattern(/\S/));

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

export { ProjectDetail } from "../projects/projectDto.ts";
export const ProjectListResponse = Schema.Array(
  Schema.Struct({
    id: ProjectId,
    slug: Slug,
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
    memberCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    createdAt: Schema.Finite,
    publishedAt: Schema.NullOr(Schema.Finite),
    updatedAt: Schema.NullOr(Schema.Finite),
  }),
);
export const CreateProjectRequest = Schema.Struct({
  title: NonBlankTitle,
  description: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
});
export const UpdateProjectRequest = Schema.Struct({
  slug: Schema.optional(Slug),
  title: Schema.optional(NonBlankTitle),
  description: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
});
export const ReplaceProjectMembersRequest = Schema.Struct({ assetIds: Schema.Array(AssetId) });
export const MoveProjectMemberRequest = Schema.Struct({
  assetId: AssetId,
  position: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export const AssetIdParam = Schema.Struct({
  id: AssetId,
});

export const AssetWithChapters = Schema.Struct({
  video: BrowserProjectAsset,
  chapters: Schema.Array(Chapter),
});
export type AssetWithChapters = typeof AssetWithChapters.Type;

export const UpdateAssetContentRequest = Schema.Struct({
  body: Schema.String,
});
export type UpdateAssetContentRequest = typeof UpdateAssetContentRequest.Type;

export const AssetListResponse = Schema.Array(BrowserProjectAsset);
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

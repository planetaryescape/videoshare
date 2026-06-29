import { Schema } from "effect";
import { Chapter, Slug, Video, VideoId } from "@videoshare/shared/Video";

export const ChapterInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.String,
  startSec: Schema.Finite,
});
export type ChapterInput = typeof ChapterInput.Type;

const NonBlankTitle = Schema.String.check(Schema.isMinLength(1));

export const CreateVideoRequest = Schema.Struct({
  title: NonBlankTitle,
  description: Schema.optional(Schema.String),
});
export type CreateVideoRequest = typeof CreateVideoRequest.Type;

export const UpdateVideoRequest = Schema.Struct({
  title: Schema.optional(NonBlankTitle),
  description: Schema.optional(Schema.String),
  chapters: Schema.optional(Schema.Array(ChapterInput)),
});
export type UpdateVideoRequest = typeof UpdateVideoRequest.Type;

export const VideoIdParam = Schema.Struct({
  id: Schema.String,
});

export const VideoWithChapters = Schema.Struct({
  video: Video,
  chapters: Schema.Array(Chapter),
});
export type VideoWithChapters = typeof VideoWithChapters.Type;

export const VideoListResponse = Schema.Array(Video);
export type VideoListResponse = typeof VideoListResponse.Type;

export const DeleteResponse = Schema.Struct({
  success: Schema.Boolean,
});
export type DeleteResponse = typeof DeleteResponse.Type;

export const SlugParam = Schema.Struct({
  slug: Slug,
});

export const VideoIdPath = Schema.Struct({
  id: VideoId,
});

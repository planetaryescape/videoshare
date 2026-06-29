import { Schema as S } from "effect";
import { m } from "foldkit/message";
import { ChapterSchema, VideoSchema } from "./model";

export const ClickedNewVideo = m("ClickedNewVideo");
export const ClickedEditVideo = m("ClickedEditVideo", { id: S.String });
export const ClickedBack = m("ClickedBack");
export const UpdatedTitle = m("UpdatedTitle", { title: S.String });
export const UpdatedDescription = m("UpdatedDescription", { description: S.String });
export const BlurredEditField = m("BlurredEditField");
export const SucceededSaveVideo = m("SucceededSaveVideo", { video: VideoSchema });
export const FailedSaveVideo = m("FailedSaveVideo", { error: S.String });
export const SubmittedCreateVideo = m("SubmittedCreateVideo");
export const SucceededCreateVideo = m("SucceededCreateVideo", { video: VideoSchema });
export const FailedCreateVideo = m("FailedCreateVideo", { error: S.String });
export const SucceededLoadVideos = m("SucceededLoadVideos", { videos: S.Array(VideoSchema) });
export const FailedLoadVideos = m("FailedLoadVideos", { error: S.String });
export const SelectedFile = m("SelectedFile", { file: S.Any });
export const SubmittedUpload = m("SubmittedUpload");
export const SucceededUpload = m("SucceededUpload", { video: VideoSchema });
export const FailedUpload = m("FailedUpload", { error: S.String });
export const ReceivedUploadProgress = m("ReceivedUploadProgress", {
  stage: S.String,
  pct: S.Number,
});
export const ClickedPublish = m("ClickedPublish", { id: S.String });
export const SucceededPublish = m("SucceededPublish", { video: VideoSchema });
export const FailedPublish = m("FailedPublish", { error: S.String });
export const ClickedUnpublish = m("ClickedUnpublish", { id: S.String });
export const SucceededUnpublish = m("SucceededUnpublish", { video: VideoSchema });
export const FailedUnpublish = m("FailedUnpublish", { error: S.String });
export const ClickedDeleteVideo = m("ClickedDeleteVideo", { id: S.String });
export const SucceededDeleteVideo = m("SucceededDeleteVideo", { id: S.String });
export const FailedDeleteVideo = m("FailedDeleteVideo", { error: S.String });
export const SucceededLoadVideoDetail = m("SucceededLoadVideoDetail", {
  video: VideoSchema,
  chapters: S.Array(ChapterSchema),
});
export const FailedLoadVideoDetail = m("FailedLoadVideoDetail", { error: S.String });
export const ClickedAddChapter = m("ClickedAddChapter");
export const ClickedRemoveChapter = m("ClickedRemoveChapter", { id: S.String });
export const UpdatedChapterTitle = m("UpdatedChapterTitle", { id: S.String, title: S.String });
export const UpdatedChapterStart = m("UpdatedChapterStart", { id: S.String, startSec: S.Number });
export const BlurredChapterField = m("BlurredChapterField");
export const SucceededSaveChapters = m("SucceededSaveChapters", {
  chapters: S.Array(ChapterSchema),
});
export const FailedSaveChapters = m("FailedSaveChapters", { error: S.String });
export const ClickedCopyLink = m("ClickedCopyLink", { url: S.String });
export const CopiedLink = m("CopiedLink");

export const Message = S.Union([
  ClickedNewVideo,
  ClickedEditVideo,
  ClickedBack,
  UpdatedTitle,
  UpdatedDescription,
  BlurredEditField,
  SucceededSaveVideo,
  FailedSaveVideo,
  SubmittedCreateVideo,
  SucceededCreateVideo,
  FailedCreateVideo,
  SucceededLoadVideos,
  FailedLoadVideos,
  SelectedFile,
  SubmittedUpload,
  SucceededUpload,
  FailedUpload,
  ReceivedUploadProgress,
  ClickedPublish,
  SucceededPublish,
  FailedPublish,
  ClickedUnpublish,
  SucceededUnpublish,
  FailedUnpublish,
  ClickedDeleteVideo,
  SucceededDeleteVideo,
  FailedDeleteVideo,
  SucceededLoadVideoDetail,
  FailedLoadVideoDetail,
  ClickedAddChapter,
  ClickedRemoveChapter,
  UpdatedChapterTitle,
  UpdatedChapterStart,
  BlurredChapterField,
  SucceededSaveChapters,
  FailedSaveChapters,
  ClickedCopyLink,
  CopiedLink,
]);
export type Message = S.Schema.Type<typeof Message>;

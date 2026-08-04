import { Schema as S } from "effect";
import { Dialog, FileDrop } from "@foldkit/ui";
import { m } from "foldkit/message";
import { ChapterSchema, VideoSchema } from "./model";

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
export const GotVideoFileDropMessage = m("GotVideoFileDropMessage", {
  message: FileDrop.Message,
});
export const GotPosterFileDropMessage = m("GotPosterFileDropMessage", {
  message: FileDrop.Message,
});
export const ClearedPoster = m("ClearedPoster");
export const SubmittedUpload = m("SubmittedUpload");
export const SucceededUpload = m("SucceededUpload", { video: VideoSchema });
export const FailedUpload = m("FailedUpload", { error: S.String });
export const FailedUploadProgress = m("FailedUploadProgress", { error: S.String });
export const ReceivedUploadProgress = m("ReceivedUploadProgress", {
  stage: S.String,
  pct: S.Finite.check(S.isBetween({ minimum: 0, maximum: 100 })),
});
export const ClickedPublish = m("ClickedPublish", { id: S.String });
export const SucceededPublish = m("SucceededPublish", { video: VideoSchema });
export const FailedPublish = m("FailedPublish", { error: S.String });
export const ClickedUnpublish = m("ClickedUnpublish", { id: S.String });
export const GotConfirmationDialogMessage = m("GotConfirmationDialogMessage", {
  message: Dialog.Message,
});
export const ClickedConfirmPendingAction = m("ClickedConfirmPendingAction");
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
export const GeneratedChapterId = m("GeneratedChapterId", {
  chapterId: S.String,
  videoId: S.String,
  startSec: S.Finite.check(S.isGreaterThanOrEqualTo(0)),
});
export const FocusedChapterTitle = m("FocusedChapterTitle", { chapterId: S.String });
export const ClickedRemoveChapter = m("ClickedRemoveChapter", { id: S.String });
export const UpdatedChapterTitle = m("UpdatedChapterTitle", { id: S.String, title: S.String });
export const UpdatedChapterStart = m("UpdatedChapterStart", { id: S.String, value: S.String });
export const CommittedChapterStart = m("CommittedChapterStart", { id: S.String });
export const ClickedSetChapterToPlayhead = m("ClickedSetChapterToPlayhead", { id: S.String });
export const BlurredChapterField = m("BlurredChapterField");
export const SucceededSaveChapters = m("SucceededSaveChapters", {
  chapters: S.Array(ChapterSchema),
});
export const FailedSaveChapters = m("FailedSaveChapters", { error: S.String });
export const ClickedCopyLink = m("ClickedCopyLink", { url: S.String });
export const CopiedLink = m("CopiedLink");
export const FailedCopyLink = m("FailedCopyLink", { error: S.String });

export const Message = S.Union([
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
  GotVideoFileDropMessage,
  GotPosterFileDropMessage,
  ClearedPoster,
  SubmittedUpload,
  SucceededUpload,
  FailedUpload,
  FailedUploadProgress,
  ReceivedUploadProgress,
  ClickedPublish,
  SucceededPublish,
  FailedPublish,
  ClickedUnpublish,
  GotConfirmationDialogMessage,
  ClickedConfirmPendingAction,
  SucceededUnpublish,
  FailedUnpublish,
  ClickedDeleteVideo,
  SucceededDeleteVideo,
  FailedDeleteVideo,
  SucceededLoadVideoDetail,
  FailedLoadVideoDetail,
  ClickedAddChapter,
  GeneratedChapterId,
  FocusedChapterTitle,
  ClickedRemoveChapter,
  UpdatedChapterTitle,
  UpdatedChapterStart,
  CommittedChapterStart,
  ClickedSetChapterToPlayhead,
  BlurredChapterField,
  SucceededSaveChapters,
  FailedSaveChapters,
  ClickedCopyLink,
  CopiedLink,
  FailedCopyLink,
]);
export type Message = S.Schema.Type<typeof Message>;

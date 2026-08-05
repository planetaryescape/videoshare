import { Schema as S } from "effect";
import { Dialog, FileDrop } from "@foldkit/ui";
import { m } from "foldkit/message";
import { ChapterSchema, AssetSchema, ProjectDetailSchema, ProjectSchema } from "./model";

export const ClickedEditAsset = m("ClickedEditAsset", { id: S.String });
export const ClickedBack = m("ClickedBack");
export const ClickedProjects = m("ClickedProjects");
export const ClickedAssets = m("ClickedAssets");
export const SubmittedCreateProject = m("SubmittedCreateProject");
export const ClickedEditProject = m("ClickedEditProject", { id: S.String });
export const UpdatedProjectTitle = m("UpdatedProjectTitle", { title: S.String });
export const UpdatedProjectDescription = m("UpdatedProjectDescription", { description: S.String });
export const UpdatedProjectPassword = m("UpdatedProjectPassword", { password: S.String });
export const BlurredProjectField = m("BlurredProjectField");
export const ClickedDeleteProject = m("ClickedDeleteProject", { id: S.String });
export const ClickedRetryProjectOperation = m("ClickedRetryProjectOperation");
export const ClickedPublishProject = m("ClickedPublishProject", { id: S.String });
export const SucceededPublishProject = m("SucceededPublishProject", { id: S.String });
export const FailedPublishProject = m("FailedPublishProject", { error: S.String });
export const ClickedUnpublishProject = m("ClickedUnpublishProject", { id: S.String });
export const SucceededUnpublishProject = m("SucceededUnpublishProject", { id: S.String });
export const FailedUnpublishProject = m("FailedUnpublishProject", { error: S.String });
export const ClickedMoveProjectMember = m("ClickedMoveProjectMember", {
  assetId: S.String,
  direction: S.Literals(["up", "down"]),
});
export const ClickedUnfileProjectMember = m("ClickedUnfileProjectMember", { assetId: S.String });
export const ClickedAssignAssetToProject = m("ClickedAssignAssetToProject", {
  assetId: S.String,
  projectId: S.String,
});
export const ClickedRetryLoadProjects = m("ClickedRetryLoadProjects");
export const SucceededLoadProjects = m("SucceededLoadProjects", {
  projects: S.Array(ProjectSchema),
});
export const FailedLoadProjects = m("FailedLoadProjects", { error: S.String });
export const SucceededLoadProject = m("SucceededLoadProject", { detail: ProjectDetailSchema });
export const FailedLoadProject = m("FailedLoadProject", { id: S.String, error: S.String });
export const SucceededSaveProject = m("SucceededSaveProject", { detail: ProjectDetailSchema });
export const FailedSaveProject = m("FailedSaveProject", { error: S.String });
export const SucceededDeleteProject = m("SucceededDeleteProject", { id: S.String });
export const FailedDeleteProject = m("FailedDeleteProject", { error: S.String });
export const UpdatedTitle = m("UpdatedTitle", { title: S.String });
export const UpdatedDescription = m("UpdatedDescription", { description: S.String });
export const BlurredEditField = m("BlurredEditField");
export const SucceededSaveAsset = m("SucceededSaveAsset", { video: AssetSchema });
export const FailedSaveAsset = m("FailedSaveAsset", { error: S.String });
export const SubmittedCreateAsset = m("SubmittedCreateAsset");
export const SucceededCreateAsset = m("SucceededCreateAsset", { video: AssetSchema });
export const FailedCreateAsset = m("FailedCreateAsset", { error: S.String });
export const SucceededLoadAssets = m("SucceededLoadAssets", { assets: S.Array(AssetSchema) });
export const FailedLoadAssets = m("FailedLoadAssets", { error: S.String });
export const GotAssetFileDropMessage = m("GotAssetFileDropMessage", {
  message: FileDrop.Message,
});
export const GotPosterFileDropMessage = m("GotPosterFileDropMessage", {
  message: FileDrop.Message,
});
export const ClearedPoster = m("ClearedPoster");
export const SubmittedUpload = m("SubmittedUpload");
export const SucceededUpload = m("SucceededUpload", { video: AssetSchema });
export const FailedUpload = m("FailedUpload", { error: S.String });
export const FailedUploadProgress = m("FailedUploadProgress", { error: S.String });
export const ReceivedUploadProgress = m("ReceivedUploadProgress", {
  stage: S.String,
  pct: S.Finite.check(S.isBetween({ minimum: 0, maximum: 100 })),
});
export const ClickedPublish = m("ClickedPublish", { id: S.String });
export const SucceededPublish = m("SucceededPublish", { video: AssetSchema });
export const FailedPublish = m("FailedPublish", { error: S.String });
export const ClickedUnpublish = m("ClickedUnpublish", { id: S.String });
export const GotConfirmationDialogMessage = m("GotConfirmationDialogMessage", {
  message: Dialog.Message,
});
export const ClickedConfirmPendingAction = m("ClickedConfirmPendingAction");
export const SucceededUnpublish = m("SucceededUnpublish", { video: AssetSchema });
export const FailedUnpublish = m("FailedUnpublish", { error: S.String });
export const ClickedDeleteAsset = m("ClickedDeleteAsset", { id: S.String });
export const SucceededDeleteAsset = m("SucceededDeleteAsset", { id: S.String });
export const FailedDeleteAsset = m("FailedDeleteAsset", { error: S.String });
export const SucceededLoadAssetDetail = m("SucceededLoadAssetDetail", {
  id: S.String,
  video: AssetSchema,
  chapters: S.Array(ChapterSchema),
});
export const FailedLoadAssetDetail = m("FailedLoadAssetDetail", { id: S.String, error: S.String });
export const ClickedAddChapter = m("ClickedAddChapter");
export const GeneratedChapterId = m("GeneratedChapterId", {
  chapterId: S.String,
  assetId: S.String,
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
  ClickedEditAsset,
  ClickedBack,
  ClickedProjects,
  ClickedAssets,
  SubmittedCreateProject,
  ClickedEditProject,
  UpdatedProjectTitle,
  UpdatedProjectDescription,
  UpdatedProjectPassword,
  BlurredProjectField,
  ClickedDeleteProject,
  ClickedRetryProjectOperation,
  ClickedPublishProject,
  SucceededPublishProject,
  FailedPublishProject,
  ClickedUnpublishProject,
  SucceededUnpublishProject,
  FailedUnpublishProject,
  ClickedMoveProjectMember,
  ClickedUnfileProjectMember,
  ClickedAssignAssetToProject,
  ClickedRetryLoadProjects,
  SucceededLoadProjects,
  FailedLoadProjects,
  SucceededLoadProject,
  FailedLoadProject,
  SucceededSaveProject,
  FailedSaveProject,
  SucceededDeleteProject,
  FailedDeleteProject,
  UpdatedTitle,
  UpdatedDescription,
  BlurredEditField,
  SucceededSaveAsset,
  FailedSaveAsset,
  SubmittedCreateAsset,
  SucceededCreateAsset,
  FailedCreateAsset,
  SucceededLoadAssets,
  FailedLoadAssets,
  GotAssetFileDropMessage,
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
  ClickedDeleteAsset,
  SucceededDeleteAsset,
  FailedDeleteAsset,
  SucceededLoadAssetDetail,
  FailedLoadAssetDetail,
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

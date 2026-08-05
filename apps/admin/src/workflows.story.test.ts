import { Option } from "effect";
import { Story } from "foldkit";
import { expect, test } from "vitest";
import {
  CopyLinkCmd,
  LoadAssetDetail,
  LoadProjects,
  PublishAssetCmd,
  SaveChaptersCmd,
  SaveAssetCmd,
  UploadAssetCmd,
} from "./commands";
import {
  BlurredChapterField,
  BlurredEditField,
  ClickedBack,
  ClickedCopyLink,
  ClickedEditAsset,
  ClickedPublish,
  CopiedLink,
  FailedCopyLink,
  FailedLoadAssetDetail,
  FailedPublish,
  FailedSaveChapters,
  FailedSaveAsset,
  FailedUpload,
  SubmittedUpload,
  SucceededLoadAssetDetail,
  SucceededLoadProjects,
  SucceededPublish,
  SucceededSaveChapters,
  SucceededSaveAsset,
  SucceededUpload,
  UpdatedChapterTitle,
  UpdatedTitle,
} from "./message";
import { EditAsset, initialModel, type Chapter, type Model, type Asset } from "./model";
import { update } from "./update";

const video: Asset = {
  id: "video-1",
  slug: "fixture-video",
  kind: "video",
  title: "Fixture Asset",
  description: "Fixture description",
  posterKey: null,
  mediaKey: "assets/video-1/master.m3u8",
  durationSec: 125,
  width: null,
  height: null,
  projectId: null,
  sortOrder: null,
  createdAt: 1_750_000_000_000,
  publishedAt: null,
  updatedAt: 1_750_000_001_000,
};

const chapter: Chapter = {
  id: "chapter-1",
  assetId: video.id,
  title: "Introduction",
  startSec: 0,
  sortOrder: 0,
};

const editModel = (patch: Partial<Model> = {}): Model => ({
  ...initialModel(),
  screen: EditAsset({ assetId: video.id }),
  assets: [video],
  editAsset: Option.some(video),
  editTitle: video.title,
  editDescription: video.description ?? "",
  ...patch,
});

test("saves metadata and surfaces save failure", () => {
  const savedAsset = { ...video, title: "Updated title" };

  Story.story(
    update,
    Story.with(editModel()),
    Story.message(UpdatedTitle({ title: savedAsset.title })),
    Story.message(BlurredEditField()),
    Story.Command.resolve(SaveAssetCmd, SucceededSaveAsset({ video: savedAsset })),
    Story.message(UpdatedTitle({ title: "Another title" })),
    Story.message(BlurredEditField()),
    Story.Command.resolve(SaveAssetCmd, FailedSaveAsset({ error: "Save failed" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Save failed"))),
  );
});

test("loads video detail and surfaces load failure", () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(ClickedEditAsset({ id: video.id })),
    Story.Command.resolve(
      LoadAssetDetail,
      SucceededLoadAssetDetail({ id: video.id, video, chapters: [chapter] }),
    ),
    Story.Command.resolve(LoadProjects, SucceededLoadProjects({ projects: [] })),
    Story.message(ClickedEditAsset({ id: "video-2" })),
    Story.Command.resolve(
      LoadAssetDetail,
      FailedLoadAssetDetail({ id: "video-2", error: "Detail unavailable" }),
    ),
    Story.Command.resolve(LoadProjects, SucceededLoadProjects({ projects: [] })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Detail unavailable"))),
  );
});

test("ignores stale asset detail responses after switching assets or navigating away", () => {
  const secondVideo = { ...video, id: "video-2", title: "Second asset" };

  const [loadingFirst] = update(initialModel(), ClickedEditAsset({ id: video.id }));
  const [loadingSecond] = update(loadingFirst, ClickedEditAsset({ id: secondVideo.id }));
  const [afterStaleSuccess] = update(
    loadingSecond,
    SucceededLoadAssetDetail({ id: video.id, video, chapters: [chapter] }),
  );

  expect(afterStaleSuccess.screen).toEqual(EditAsset({ assetId: secondVideo.id }));
  expect(afterStaleSuccess.editAsset).toEqual(Option.none());
  expect(afterStaleSuccess.editTitle).toBe("");

  const [loadedSecond] = update(
    afterStaleSuccess,
    SucceededLoadAssetDetail({ id: secondVideo.id, video: secondVideo, chapters: [] }),
  );
  expect(loadedSecond.editAsset).toEqual(Option.some(secondVideo));
  expect(loadedSecond.editTitle).toBe(secondVideo.title);

  const [afterStaleFailureForFirst] = update(
    loadedSecond,
    FailedLoadAssetDetail({ id: video.id, error: "Detail unavailable" }),
  );
  expect(afterStaleFailureForFirst.errorMessage).toEqual(Option.none());

  const [navigatedAway] = update(afterStaleFailureForFirst, ClickedBack());
  const [afterStaleFailure] = update(
    navigatedAway,
    FailedLoadAssetDetail({ id: secondVideo.id, error: "Detail unavailable" }),
  );

  expect(afterStaleFailure.screen).toEqual({ _tag: "ListAssets" });
  expect(afterStaleFailure.errorMessage).toEqual(Option.none());
});

test("saves chapters and surfaces save failure", () => {
  const updatedChapter = { ...chapter, title: "Opening" };

  Story.story(
    update,
    Story.with(editModel({ editChapters: [chapter] })),
    Story.message(BlurredChapterField()),
    Story.Command.resolve(SaveChaptersCmd, SucceededSaveChapters({ chapters: [chapter] })),
    Story.message(UpdatedChapterTitle({ id: chapter.id, title: updatedChapter.title })),
    Story.message(BlurredChapterField()),
    Story.Command.resolve(SaveChaptersCmd, FailedSaveChapters({ error: "Chapter save failed" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Chapter save failed"))),
  );
});

test("uploads media and handles upload failure", () => {
  const file = new File(["video"], "video.mp4", { type: "video/mp4" });

  Story.story(
    update,
    Story.with(editModel({ selectedFile: Option.some(file) })),
    Story.message(SubmittedUpload()),
    Story.Command.resolve(UploadAssetCmd, SucceededUpload({ video })),
    Story.model((model) => expect(model.isUploading).toBe(false)),
  );

  Story.story(
    update,
    Story.with(editModel({ selectedFile: Option.some(file) })),
    Story.message(SubmittedUpload()),
    Story.Command.resolve(UploadAssetCmd, FailedUpload({ error: "Upload failed" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Upload failed"))),
  );
});

test("publishes media and surfaces publish failure", () => {
  const publishedAsset = {
    ...video,
    publishedAt: 1_750_000_002_000,
    updatedAt: 1_750_000_002_000,
  };

  Story.story(
    update,
    Story.with(editModel()),
    Story.message(ClickedPublish({ id: video.id })),
    Story.Command.resolve(PublishAssetCmd, SucceededPublish({ video: publishedAsset })),
    Story.message(ClickedPublish({ id: video.id })),
    Story.Command.resolve(PublishAssetCmd, FailedPublish({ error: "Publish failed" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Publish failed"))),
  );
});

test("copies a share link and surfaces copy failure", () => {
  const url = "https://video.planetaryescape.co.za/fixture-video";

  Story.story(
    update,
    Story.with(editModel()),
    Story.message(ClickedCopyLink({ url })),
    Story.Command.resolve(CopyLinkCmd, CopiedLink()),
    Story.message(ClickedCopyLink({ url })),
    Story.Command.resolve(CopyLinkCmd, FailedCopyLink({ error: "Copy failed" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Copy failed"))),
  );
});

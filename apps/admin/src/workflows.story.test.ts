import { Option } from "effect";
import { Story } from "foldkit";
import { expect, test } from "vitest";
import {
  CopyLinkCmd,
  LoadVideoDetail,
  PublishVideoCmd,
  SaveChaptersCmd,
  SaveVideoCmd,
  UploadVideoCmd,
} from "./commands";
import {
  BlurredChapterField,
  BlurredEditField,
  ClickedCopyLink,
  ClickedEditVideo,
  ClickedPublish,
  CopiedLink,
  FailedCopyLink,
  FailedLoadVideoDetail,
  FailedPublish,
  FailedSaveChapters,
  FailedSaveVideo,
  FailedUpload,
  SubmittedUpload,
  SucceededLoadVideoDetail,
  SucceededPublish,
  SucceededSaveChapters,
  SucceededSaveVideo,
  SucceededUpload,
  UpdatedChapterTitle,
  UpdatedTitle,
} from "./message";
import { EditVideo, initialModel, type Chapter, type Model, type Video } from "./model";
import { update } from "./update";

const video: Video = {
  id: "video-1",
  slug: "fixture-video",
  kind: "video",
  title: "Fixture Video",
  description: "Fixture description",
  posterKey: null,
  hlsKey: "videos/video-1/master.m3u8",
  durationSec: 125,
  createdAt: 1_750_000_000_000,
  publishedAt: null,
  updatedAt: 1_750_000_001_000,
};

const chapter: Chapter = {
  id: "chapter-1",
  videoId: video.id,
  title: "Introduction",
  startSec: 0,
  sortOrder: 0,
};

const editModel = (patch: Partial<Model> = {}): Model => ({
  ...initialModel(),
  screen: EditVideo({ videoId: video.id }),
  videos: [video],
  editVideo: Option.some(video),
  editTitle: video.title,
  editDescription: video.description ?? "",
  ...patch,
});

test("saves metadata and surfaces save failure", () => {
  const savedVideo = { ...video, title: "Updated title" };

  Story.story(
    update,
    Story.with(editModel()),
    Story.message(UpdatedTitle({ title: savedVideo.title })),
    Story.message(BlurredEditField()),
    Story.Command.resolve(SaveVideoCmd, SucceededSaveVideo({ video: savedVideo })),
    Story.message(UpdatedTitle({ title: "Another title" })),
    Story.message(BlurredEditField()),
    Story.Command.resolve(SaveVideoCmd, FailedSaveVideo({ error: "Save failed" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Save failed"))),
  );
});

test("loads video detail and surfaces load failure", () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(ClickedEditVideo({ id: video.id })),
    Story.Command.resolve(
      LoadVideoDetail,
      SucceededLoadVideoDetail({ video, chapters: [chapter] }),
    ),
    Story.message(ClickedEditVideo({ id: "video-2" })),
    Story.Command.resolve(LoadVideoDetail, FailedLoadVideoDetail({ error: "Detail unavailable" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Detail unavailable"))),
  );
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
    Story.Command.resolve(UploadVideoCmd, SucceededUpload({ video })),
    Story.model((model) => expect(model.isUploading).toBe(false)),
  );

  Story.story(
    update,
    Story.with(editModel({ selectedFile: Option.some(file) })),
    Story.message(SubmittedUpload()),
    Story.Command.resolve(UploadVideoCmd, FailedUpload({ error: "Upload failed" })),
    Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Upload failed"))),
  );
});

test("publishes media and surfaces publish failure", () => {
  const publishedVideo = {
    ...video,
    publishedAt: 1_750_000_002_000,
    updatedAt: 1_750_000_002_000,
  };

  Story.story(
    update,
    Story.with(editModel()),
    Story.message(ClickedPublish({ id: video.id })),
    Story.Command.resolve(PublishVideoCmd, SucceededPublish({ video: publishedVideo })),
    Story.message(ClickedPublish({ id: video.id })),
    Story.Command.resolve(PublishVideoCmd, FailedPublish({ error: "Publish failed" })),
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

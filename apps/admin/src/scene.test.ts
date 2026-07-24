import { Option } from "effect";
import { Dialog } from "@foldkit/ui";
import { Scene } from "foldkit";
import { describe, test } from "vitest";
import {
  DeleteVideoConfirmation,
  EditVideo,
  initialModel,
  type Chapter,
  type Video,
} from "./model";
import { update } from "./update";
import { view } from "./view";

const video: Video = {
  id: "video-1",
  slug: "fixture-video",
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

describe("admin scenes", () => {
  test("renders an empty video list", () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      Scene.expect(Scene.role("heading", { name: "Videos", level: 1 })).toExist(),
      Scene.expect(Scene.text("No videos yet")).toExist(),
      Scene.expect(Scene.role("button", { name: "New Video" })).toExist(),
    );
  });

  test("renders an uploaded draft", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: { _tag: "EditVideo", videoId: video.id },
        videos: [video],
        editVideo: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
      }),
      Scene.expect(Scene.role("heading", { name: video.title, level: 1 })).toExist(),
      Scene.expect(Scene.role("button", { name: "Publish" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Copy link" })).toExist(),
    );
  });

  test("announces upload progress", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditVideo({ videoId: video.id }),
        editVideo: Option.some({ ...video, hlsKey: "" }),
        editTitle: video.title,
        editDescription: video.description ?? "",
        isUploading: true,
        uploadingVideoId: Option.some(video.id),
        uploadStage: "transcoding",
        uploadPct: 42,
      }),
      Scene.expect(Scene.role("button", { name: "Uploading & Transcoding..." })).toExist(),
      Scene.expect(Scene.role("progressbar", { name: "Upload and transcode progress" })).toExist(),
      Scene.expect(Scene.text("42%", { exact: true })).toExist(),
    );
  });

  test("renders published video controls and pending changes", () => {
    const publishedVideo = {
      ...video,
      publishedAt: 1_750_000_002_000,
      updatedAt: 1_750_000_003_000,
    };

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditVideo({ videoId: video.id }),
        editVideo: Option.some(publishedVideo),
        editTitle: publishedVideo.title,
        editDescription: publishedVideo.description ?? "",
      }),
      Scene.expect(Scene.role("button", { name: "Republish" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Unpublish" })).toExist(),
      Scene.expect(Scene.text("Local changes are not live yet. Republish to update.")).toExist(),
    );
  });

  test("renders chapter validation", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditVideo({ videoId: video.id }),
        editVideo: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
        editChapters: [{ ...chapter, title: "" }],
        chapterValidationError: Option.some("Every chapter needs a title before saving"),
      }),
      Scene.expect(Scene.role("alert")).toHaveText("Every chapter needs a title before saving"),
      Scene.expect(Scene.label("Chapter title")).toExist(),
    );
  });

  test("renders destructive confirmation", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        confirmationDialog: Dialog.init({ id: "video-action-confirmation", isOpen: true }),
        pendingConfirmation: Option.some(DeleteVideoConfirmation({ videoId: video.id })),
      }),
      Scene.expect(Scene.role("dialog")).toExist(),
      Scene.expect(Scene.role("heading", { name: "Delete video?" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Cancel" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Delete" })).toExist(),
    );
  });
});

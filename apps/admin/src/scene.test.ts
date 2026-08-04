import { Option } from "effect";
import { Dialog } from "@foldkit/ui";
import { Scene } from "foldkit";
import { describe, test } from "vitest";
import {
  DeleteAssetConfirmation,
  EditAsset,
  initialModel,
  type Chapter,
  type Asset,
} from "./model";
import { update } from "./update";
import { view } from "./view";

const video: Asset = {
  id: "video-1",
  slug: "fixture-video",
  kind: "video",
  title: "Fixture Asset",
  description: "Fixture description",
  posterKey: null,
  mediaKey: "assets/video-1/master.m3u8",
  durationSec: 125,
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

describe("admin scenes", () => {
  test("renders an empty video list", () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      Scene.expect(Scene.role("heading", { name: "Assets", level: 1 })).toExist(),
      Scene.expect(Scene.text("No assets yet")).toExist(),
      Scene.expect(Scene.role("button", { name: "New Asset" })).toExist(),
    );
  });

  test("renders an uploaded draft", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: { _tag: "EditAsset", assetId: video.id },
        assets: [video],
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
      }),
      Scene.expect(Scene.role("heading", { name: video.title, level: 1 })).toExist(),
      Scene.expect(Scene.role("heading", { name: "Review playback", level: 2 })).toExist(),
      Scene.expect(Scene.role("button", { name: "Add at playhead" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Publish" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Copy link" })).toExist(),
    );
  });

  test("waits for playback before offering chapter capture", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, mediaKey: "" }),
        editTitle: video.title,
        editDescription: video.description ?? "",
      }),
      Scene.expect(Scene.role("button", { name: "Add at playhead" })).not.toExist(),
    );
  });

  test("announces upload progress", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, mediaKey: "" }),
        editTitle: video.title,
        editDescription: video.description ?? "",
        isUploading: true,
        uploadingAssetId: Option.some(video.id),
        uploadStage: "transcoding",
        uploadPct: 42,
      }),
      Scene.expect(Scene.role("button", { name: "Uploading & Transcoding..." })).toExist(),
      Scene.expect(Scene.role("progressbar", { name: "Upload and transcode progress" })).toExist(),
      Scene.expect(Scene.text("42%", { exact: true })).toExist(),
    );
  });

  test("renders published video controls and pending changes", () => {
    const publishedAsset = {
      ...video,
      publishedAt: 1_750_000_002_000,
      updatedAt: 1_750_000_003_000,
    };

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(publishedAsset),
        editTitle: publishedAsset.title,
        editDescription: publishedAsset.description ?? "",
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
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
        editChapters: [{ ...chapter, title: "" }],
        chapterValidationError: Option.some("Every chapter needs a title before saving"),
      }),
      Scene.expect(Scene.role("alert")).toHaveText("Needs a title"),
      Scene.expect(Scene.text("Every chapter needs a title before saving")).toExist(),
      Scene.expect(Scene.label("Chapter title")).toExist(),
    );
  });

  test("renders editable chapter start times in playback order", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
        editChapters: [
          { ...chapter, title: "Intro", startSec: 0, sortOrder: 0 },
          { ...chapter, id: "chapter-2", title: "Shipping", startSec: 65, sortOrder: 1 },
        ],
      }),
      Scene.expect(Scene.label("Start time")).toExist(),
      Scene.expect(Scene.role("button", { name: "Remove chapter Intro" })).toExist(),
      Scene.expect(
        Scene.role("button", { name: "Set start time of Shipping to the playhead" }),
      ).toExist(),
    );
  });

  test("flags chapters that share a timestamp", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
        editChapters: [
          { ...chapter, title: "Intro", startSec: 4, sortOrder: 0 },
          { ...chapter, id: "chapter-2", title: "Shipping", startSec: 4, sortOrder: 1 },
        ],
        chapterValidationError: Option.some(
          "Two chapters share a timestamp. Change one before saving.",
        ),
      }),
      Scene.expect(Scene.role("alert")).toHaveText("Another chapter already starts at 0:04"),
    );
  });

  test("renders destructive confirmation", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        confirmationDialog: Dialog.init({ id: "video-action-confirmation", isOpen: true }),
        pendingConfirmation: Option.some(DeleteAssetConfirmation({ assetId: video.id })),
      }),
      Scene.expect(Scene.role("dialog")).toExist(),
      Scene.expect(Scene.role("heading", { name: "Delete video?" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Cancel" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Delete" })).toExist(),
    );
  });
});

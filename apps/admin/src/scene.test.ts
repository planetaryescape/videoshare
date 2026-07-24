import { Option } from "effect";
import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { initialModel, type Video } from "./model";
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
});

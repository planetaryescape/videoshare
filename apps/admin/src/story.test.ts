import { Option } from "effect";
import { Story } from "foldkit";
import { describe, expect, test } from "vitest";
import { CreateVideoCmd, GenerateChapterId, LoadVideos } from "./commands";
import {
  ClickedAddChapter,
  FailedCreateVideo,
  FailedLoadVideos,
  GeneratedChapterId,
  SubmittedCreateVideo,
  SucceededCreateVideo,
  SucceededLoadVideos,
} from "./message";
import { EditVideo, initialModel, type Video } from "./model";
import { init, update } from "./update";

const video: Video = {
  id: "video-1",
  slug: "fixture-video",
  title: "Fixture Video",
  description: "Fixture description",
  posterKey: null,
  hlsKey: "",
  durationSec: 0,
  createdAt: 1_750_000_000_000,
  publishedAt: null,
  updatedAt: null,
};

describe("admin story", () => {
  test("loads videos on initialization", () => {
    const [model, commands] = init();

    expect(model).toEqual(initialModel());
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe(LoadVideos.name);
  });

  test("stores loaded videos and load failures", () => {
    Story.story(
      update,
      Story.with(initialModel()),
      Story.message(SucceededLoadVideos({ videos: [video] })),
      Story.model((model) => expect(model.videos).toEqual([video])),
      Story.message(FailedLoadVideos({ error: "Network unavailable" })),
      Story.model((model) =>
        expect(model.errorMessage).toEqual(Option.some("Network unavailable")),
      ),
    );
  });

  test("opens a newly created video", () => {
    Story.story(
      update,
      Story.with(initialModel()),
      Story.message(SubmittedCreateVideo()),
      Story.Command.expectExact(CreateVideoCmd()),
      Story.Command.resolve(CreateVideoCmd, SucceededCreateVideo({ video })),
      Story.model((model) => {
        expect(model.screen).toEqual({ _tag: "EditVideo", videoId: video.id });
        expect(model.editVideo).toEqual(Option.some(video));
      }),
    );
  });

  test("surfaces create failures", () => {
    Story.story(
      update,
      Story.with(initialModel()),
      Story.message(SubmittedCreateVideo()),
      Story.Command.resolve(CreateVideoCmd, FailedCreateVideo({ error: "Create failed" })),
      Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Create failed"))),
    );
  });

  test("adds chapters after generating an id", () => {
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditVideo({ videoId: video.id }),
        editVideo: Option.some(video),
      }),
      Story.message(ClickedAddChapter()),
      Story.Command.expectExact(GenerateChapterId({ videoId: video.id })),
      Story.Command.resolve(
        GenerateChapterId,
        GeneratedChapterId({ chapterId: "chapter-1", videoId: video.id }),
      ),
      Story.model((model) =>
        expect(model.editChapters).toEqual([
          {
            id: "chapter-1",
            videoId: video.id,
            title: "",
            startSec: 0,
            sortOrder: 0,
          },
        ]),
      ),
    );
  });
});

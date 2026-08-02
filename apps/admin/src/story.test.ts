import { Option } from "effect";
import { Story } from "foldkit";
import { describe, expect, test } from "vitest";
import { CreateVideoCmd, FocusChapterTitle, GenerateChapterId, LoadVideos } from "./commands";
import {
  BlurredChapterField,
  ClickedAddChapter,
  ClickedBack,
  ClickedConfirmPendingAction,
  ClickedDeleteVideo,
  ClickedEditVideo,
  ClickedUnpublish,
  FailedCreateVideo,
  FailedDeleteVideo,
  FailedLoadVideos,
  FailedUnpublish,
  FailedUploadProgress,
  FocusedChapterTitle,
  GeneratedChapterId,
  SubmittedCreateVideo,
  SubmittedUpload,
  SucceededCreateVideo,
  SucceededDeleteVideo,
  SucceededLoadVideos,
  SucceededUnpublish,
  SucceededUpload,
} from "./message";
import { EditVideo, initialModel, type Video } from "./model";
import { init, update } from "./update";

const video: Video = {
  id: "video-1",
  slug: "fixture-video",
  kind: "video",
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
        GeneratedChapterId({ chapterId: "chapter-1", videoId: video.id, startSec: 42 }),
      ),
      Story.Command.expectExact(FocusChapterTitle({ chapterId: "chapter-1" })),
      Story.Command.resolve(FocusChapterTitle, FocusedChapterTitle({ chapterId: "chapter-1" })),
      Story.model((model) =>
        expect(model.editChapters).toEqual([
          {
            id: "chapter-1",
            videoId: video.id,
            title: "",
            startSec: 42,
            sortOrder: 0,
          },
        ]),
      ),
    );
  });

  test("surfaces invalid chapter drafts", () => {
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditVideo({ videoId: video.id }),
        editVideo: Option.some(video),
        editChapters: [
          {
            id: "chapter-1",
            videoId: video.id,
            title: "",
            startSec: 0,
            sortOrder: 0,
          },
        ],
      }),
      Story.message(BlurredChapterField()),
      Story.Command.expectNone(),
      Story.model((model) =>
        expect(model.chapterValidationError).toEqual(
          Option.some("Every chapter needs a title before saving"),
        ),
      ),
    );
  });

  test("waits for confirmation before deleting", () => {
    const [pendingModel, pendingCommands] = update(
      initialModel(),
      ClickedDeleteVideo({ id: video.id }),
    );

    expect(pendingModel.pendingConfirmation).toEqual(
      Option.some({ _tag: "DeleteVideoConfirmation", videoId: video.id }),
    );
    expect(pendingCommands.map((command) => command.name)).not.toContain("DeleteVideo");

    const [confirmedModel, confirmedCommands] = update(pendingModel, ClickedConfirmPendingAction());

    expect(confirmedModel.pendingConfirmation).toEqual(Option.none());
    expect(confirmedCommands.map((command) => command.name)).toContain("DeleteVideo");
  });

  test("keeps upload ownership until the upload command finishes", () => {
    const [uploadingModel] = update(
      {
        ...initialModel(),
        screen: EditVideo({ videoId: video.id }),
        editVideo: Option.some(video),
        selectedFile: Option.some(new File(["video"], "video.mp4", { type: "video/mp4" })),
      },
      SubmittedUpload(),
    );

    expect(uploadingModel.uploadingVideoId).toEqual(Option.some(video.id));

    const [afterProgressFailure] = update(
      uploadingModel,
      FailedUploadProgress({ error: "Progress unavailable" }),
    );
    expect(afterProgressFailure.isUploading).toBe(true);
    expect(afterProgressFailure.uploadingVideoId).toEqual(Option.some(video.id));

    const [afterBack] = update(afterProgressFailure, ClickedBack());
    const [afterEdit] = update(afterBack, ClickedEditVideo({ id: "video-2" }));
    expect(afterEdit.screen).toEqual(EditVideo({ videoId: video.id }));

    const [completedModel] = update(afterEdit, SucceededUpload({ video }));
    expect(completedModel.isUploading).toBe(false);
    expect(completedModel.uploadingVideoId).toEqual(Option.none());
  });

  test("applies delete success and failure outcomes", () => {
    const model = { ...initialModel(), videos: [video] };
    const [deletedModel] = update(model, SucceededDeleteVideo({ id: video.id }));
    const [failedModel] = update(model, FailedDeleteVideo({ error: "Delete failed" }));

    expect(deletedModel.videos).toEqual([]);
    expect(failedModel.errorMessage).toEqual(Option.some("Delete failed"));
  });

  test("confirms unpublish and applies its outcomes", () => {
    const publishedVideo = { ...video, publishedAt: 1_750_000_002_000 };
    const model = {
      ...initialModel(),
      screen: EditVideo({ videoId: video.id }),
      videos: [publishedVideo],
      editVideo: Option.some(publishedVideo),
    };
    const [pendingModel] = update(model, ClickedUnpublish({ id: video.id }));
    const [confirmedModel, commands] = update(pendingModel, ClickedConfirmPendingAction());

    expect(confirmedModel.isUnpublishing).toBe(true);
    expect(commands.map((command) => command.name)).toContain("UnpublishVideo");

    const [unpublishedModel] = update(
      confirmedModel,
      SucceededUnpublish({ video: { ...publishedVideo, publishedAt: null } }),
    );
    const [failedModel] = update(confirmedModel, FailedUnpublish({ error: "Unpublish failed" }));

    expect(unpublishedModel.isUnpublishing).toBe(false);
    expect(unpublishedModel.editVideo).toEqual(
      Option.some({ ...publishedVideo, publishedAt: null }),
    );
    expect(failedModel.isUnpublishing).toBe(false);
    expect(failedModel.errorMessage).toEqual(Option.some("Unpublish failed"));
  });
});

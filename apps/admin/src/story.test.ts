import { Option } from "effect";
import { Story } from "foldkit";
import { describe, expect, test } from "vitest";
import {
  CreateAssetCmd,
  FocusChapterTitle,
  GenerateChapterId,
  LoadAssets,
  LoadProjects,
  SaveChaptersCmd,
  SaveMarkdownCmd,
} from "./commands";
import {
  BlurredChapterField,
  ClickedAddChapter,
  CommittedChapterStart,
  UpdatedChapterStart,
  UpdatedChapterTitle,
  ClickedBack,
  ClickedConfirmPendingAction,
  ClickedDeleteAsset,
  ClickedEditAsset,
  ClickedSaveMarkdown,
  ClickedUnpublish,
  FailedCreateAsset,
  FailedDeleteAsset,
  FailedLoadAssets,
  FailedUnpublish,
  FailedUploadProgress,
  FocusedChapterTitle,
  GeneratedChapterId,
  GotMarkdownSaved,
  SubmittedCreateAsset,
  SubmittedUpload,
  SucceededCreateAsset,
  SucceededDeleteAsset,
  SucceededLoadAssets,
  SucceededSaveChapters,
  SucceededUnpublish,
  SucceededUpload,
  ToggledMarkdownPreview,
  UpdatedMarkdownBody,
} from "./message";
import { EditAsset, initialModel, type Asset } from "./model";
import { init, update } from "./update";

const video: Asset = {
  id: "video-1",
  slug: "fixture-video",
  kind: "video",
  title: "Fixture Asset",
  description: "Fixture description",
  posterKey: null,
  mediaKey: "",
  durationSec: 0,
  width: null,
  height: null,
  projectId: null,
  sortOrder: null,
  createdAt: 1_750_000_000_000,
  publishedAt: null,
  updatedAt: null,
};

describe("admin story", () => {
  test("loads assets on initialization", () => {
    const [model, commands] = init();

    expect(model).toEqual(initialModel());
    expect(commands.map((command) => command.name)).toEqual([LoadAssets.name, LoadProjects.name]);
  });

  test("stores loaded assets and load failures", () => {
    Story.story(
      update,
      Story.with(initialModel()),
      Story.message(SucceededLoadAssets({ assets: [video] })),
      Story.model((model) => expect(model.assets).toEqual([video])),
      Story.message(FailedLoadAssets({ error: "Network unavailable" })),
      Story.model((model) =>
        expect(model.errorMessage).toEqual(Option.some("Network unavailable")),
      ),
    );
  });

  test("opens a newly created video", () => {
    Story.story(
      update,
      Story.with(initialModel()),
      Story.message(SubmittedCreateAsset()),
      Story.Command.expectExact(CreateAssetCmd()),
      Story.Command.resolve(CreateAssetCmd, SucceededCreateAsset({ video })),
      Story.model((model) => {
        expect(model.screen).toEqual({ _tag: "EditAsset", assetId: video.id });
        expect(model.editAsset).toEqual(Option.some(video));
      }),
    );
  });

  test("surfaces create failures", () => {
    Story.story(
      update,
      Story.with(initialModel()),
      Story.message(SubmittedCreateAsset()),
      Story.Command.resolve(CreateAssetCmd, FailedCreateAsset({ error: "Create failed" })),
      Story.model((model) => expect(model.errorMessage).toEqual(Option.some("Create failed"))),
    );
  });

  test("adds chapters after generating an id", () => {
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, mediaKey: "assets/video-1/master.m3u8" }),
      }),
      Story.message(ClickedAddChapter()),
      Story.Command.expectExact(GenerateChapterId({ assetId: video.id, startSec: 0 })),
      Story.Command.resolve(
        GenerateChapterId,
        GeneratedChapterId({ chapterId: "chapter-1", assetId: video.id, startSec: 42 }),
      ),
      Story.Command.expectExact(FocusChapterTitle({ chapterId: "chapter-1" })),
      Story.Command.resolve(FocusChapterTitle, FocusedChapterTitle({ chapterId: "chapter-1" })),
      Story.model((model) =>
        expect(model.editChapters).toEqual([
          {
            id: "chapter-1",
            assetId: video.id,
            title: "",
            startSec: 42,
            sortOrder: 0,
          },
        ]),
      ),
    );
  });

  test("re-sorts chapters when a start time is edited", () => {
    const editedAsset = { ...video, durationSec: 300 };
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(editedAsset),
        editChapters: [
          { id: "a", assetId: video.id, title: "Intro", startSec: 0, sortOrder: 0 },
          { id: "b", assetId: video.id, title: "Shipping", startSec: 60, sortOrder: 1 },
        ],
      }),
      Story.message(UpdatedChapterStart({ id: "b", value: "0:10" })),
      Story.model((model) => expect(model.chapterStartDrafts.b).toBe("0:10")),
      Story.message(UpdatedChapterStart({ id: "a", value: "1:30" })),
      Story.message(CommittedChapterStart({ id: "a" })),
      Story.model((model) => {
        expect(model.editChapters.map((c) => c.id)).toEqual(["b", "a"]);
        expect(model.editChapters.map((c) => c.startSec)).toEqual([60, 90]);
        expect(model.editChapters.map((c) => c.sortOrder)).toEqual([0, 1]);
        expect(model.chapterStartDrafts.a).toBeUndefined();
      }),
      Story.Command.expectExact(
        SaveChaptersCmd({
          id: video.id,
          chapters: [
            { id: "b", assetId: video.id, title: "Shipping", startSec: 60, sortOrder: 0 },
            { id: "a", assetId: video.id, title: "Intro", startSec: 90, sortOrder: 1 },
          ],
        }),
      ),
      Story.Command.resolve(
        SaveChaptersCmd,
        SucceededSaveChapters({
          chapters: [
            { id: "b", assetId: video.id, title: "Shipping", startSec: 60, sortOrder: 0 },
            { id: "a", assetId: video.id, title: "Intro", startSec: 90, sortOrder: 1 },
          ],
        }),
      ),
    );
  });

  test("blocks saving when two chapters share a timestamp", () => {
    const editedAsset = { ...video, durationSec: 300 };
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(editedAsset),
        editChapters: [
          { id: "a", assetId: video.id, title: "Intro", startSec: 0, sortOrder: 0 },
          { id: "b", assetId: video.id, title: "Shipping", startSec: 60, sortOrder: 1 },
        ],
      }),
      Story.message(UpdatedChapterStart({ id: "b", value: "0:00" })),
      Story.message(CommittedChapterStart({ id: "b" })),
      Story.Command.expectNone(),
      Story.model((model) =>
        expect(model.chapterValidationError).toEqual(
          Option.some("Two chapters share a timestamp. Change one before saving."),
        ),
      ),
    );
  });

  test("rejects an unparseable start time without touching the chapter", () => {
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, durationSec: 300 }),
        editChapters: [{ id: "a", assetId: video.id, title: "Intro", startSec: 30, sortOrder: 0 }],
      }),
      Story.message(UpdatedChapterStart({ id: "a", value: "nope" })),
      Story.message(CommittedChapterStart({ id: "a" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.editChapters[0]?.startSec).toBe(30);
        expect(model.chapterStartDrafts.a).toBe("nope");
        expect(model.chapterValidationError).toEqual(
          Option.some("Timestamp must look like 0:45, 1:02:30, or a number of seconds"),
        );
      }),
    );
  });

  test("clamps an edited start time to the media duration", () => {
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, durationSec: 54 }),
        editChapters: [{ id: "a", assetId: video.id, title: "Intro", startSec: 0, sortOrder: 0 }],
      }),
      Story.message(UpdatedChapterStart({ id: "a", value: "9:99" })),
      Story.message(UpdatedChapterStart({ id: "a", value: "9:00" })),
      Story.message(CommittedChapterStart({ id: "a" })),
      Story.model((model) => expect(model.editChapters[0]?.startSec).toBe(54)),
      Story.Command.resolve(
        SaveChaptersCmd,
        SucceededSaveChapters({
          chapters: [{ id: "a", assetId: video.id, title: "Intro", startSec: 54, sortOrder: 0 }],
        }),
      ),
    );
  });

  test("preserves title edits made while chapters are saving", () => {
    const chapter = { id: "a", assetId: video.id, title: "Intro", startSec: 0, sortOrder: 0 };
    const base = {
      ...initialModel(),
      screen: EditAsset({ assetId: video.id }),
      editAsset: Option.some(video),
      editChapters: [chapter],
    };
    const [saving] = update(base, BlurredChapterField());
    const [edited] = update(saving, UpdatedChapterTitle({ id: "a", title: "Opening" }));
    const [afterResponse, commands] = update(
      edited,
      SucceededSaveChapters({ chapters: [chapter] }),
    );

    expect(edited.chapterSaveQueued).toBe(true);
    expect(afterResponse.editChapters[0]?.title).toBe("Opening");
    expect(commands.map((command) => command.name)).toEqual([SaveChaptersCmd.name]);
  });

  test("does not queue an unchanged chapter save", () => {
    const chapter = { id: "a", assetId: video.id, title: "Intro", startSec: 0, sortOrder: 0 };
    const base = {
      ...initialModel(),
      screen: EditAsset({ assetId: video.id }),
      editAsset: Option.some(video),
      editChapters: [chapter],
    };
    const [saving] = update(base, BlurredChapterField());
    const [afterBlur, commands] = update(saving, BlurredChapterField());

    expect(afterBlur.chapterSaveQueued).toBe(false);
    expect(commands).toEqual([]);
  });

  test("keeps draft validation visible across title edits", () => {
    const base = {
      ...initialModel(),
      screen: EditAsset({ assetId: video.id }),
      editAsset: Option.some({ ...video, durationSec: 300 }),
      editChapters: [
        { id: "a", assetId: video.id, title: "Intro", startSec: 0, sortOrder: 0 },
        { id: "b", assetId: video.id, title: "Middle", startSec: 60, sortOrder: 1 },
      ],
    };
    const [drafted] = update(base, UpdatedChapterStart({ id: "b", value: "0:00" }));
    const [invalid] = update(drafted, CommittedChapterStart({ id: "b" }));
    const [titled] = update(invalid, UpdatedChapterTitle({ id: "a", title: "Opening" }));

    expect(titled.chapterStartDrafts.b).toBe("0:00");
    expect(titled.chapterValidationError).toEqual(
      Option.some("Two chapters share a timestamp. Change one before saving."),
    );
  });

  test("clears stale timestamp validation when a draft returns to the saved value", () => {
    const base = {
      ...initialModel(),
      screen: EditAsset({ assetId: video.id }),
      editAsset: Option.some({ ...video, durationSec: 300 }),
      editChapters: [{ id: "a", assetId: video.id, title: "Intro", startSec: 30, sortOrder: 0 }],
      chapterStartDrafts: { a: "0:30" },
      chapterValidationError: Option.some("Invalid timestamp"),
    };
    const [committed] = update(base, CommittedChapterStart({ id: "a" }));

    expect(committed.chapterStartDrafts.a).toBeUndefined();
    expect(committed.chapterValidationError).toEqual(Option.none());
  });

  test("surfaces invalid chapter drafts", () => {
    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(video),
        editChapters: [
          {
            id: "chapter-1",
            assetId: video.id,
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
      ClickedDeleteAsset({ id: video.id }),
    );

    expect(pendingModel.pendingConfirmation).toEqual(
      Option.some({ _tag: "DeleteAssetConfirmation", assetId: video.id }),
    );
    expect(pendingCommands.map((command) => command.name)).not.toContain("DeleteAsset");

    const [confirmedModel, confirmedCommands] = update(pendingModel, ClickedConfirmPendingAction());

    expect(confirmedModel.pendingConfirmation).toEqual(Option.none());
    expect(confirmedCommands.map((command) => command.name)).toContain("DeleteAsset");
  });

  test("requires a saved asset before upload", () => {
    const [model] = update(
      {
        ...initialModel(),
        selectedFile: Option.some(new File(["media"], "recording.mp3", { type: "audio/mpeg" })),
      },
      SubmittedUpload(),
    );

    expect(model.errorMessage).toEqual(
      Option.some("Save the asset before uploading to create a stable identifier"),
    );
  });

  test("keeps upload ownership until the upload command finishes", () => {
    const uploadedAsset = { ...video, mediaKey: "assets/video-1/master.m3u8", durationSec: 42 };
    const [uploadingModel] = update(
      {
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        assets: [video],
        editAsset: Option.some(video),
        selectedFile: Option.some(new File(["video"], "video.mp4", { type: "video/mp4" })),
      },
      SubmittedUpload(),
    );

    expect(uploadingModel.uploadingAssetId).toEqual(Option.some(video.id));

    const [afterProgressFailure] = update(
      uploadingModel,
      FailedUploadProgress({ error: "Progress unavailable" }),
    );
    expect(afterProgressFailure.isUploading).toBe(true);
    expect(afterProgressFailure.uploadingAssetId).toEqual(Option.some(video.id));

    const [afterBack] = update(afterProgressFailure, ClickedBack());
    const [afterEdit] = update(afterBack, ClickedEditAsset({ id: "video-2" }));
    expect(afterEdit.screen).toEqual(EditAsset({ assetId: video.id }));

    const [completedModel] = update(afterEdit, SucceededUpload({ video: uploadedAsset }));
    expect(completedModel.isUploading).toBe(false);
    expect(completedModel.uploadingAssetId).toEqual(Option.none());
    expect(completedModel.editAsset).toEqual(Option.some(uploadedAsset));
    expect(completedModel.assets).toEqual([uploadedAsset]);
  });

  test("applies delete success and failure outcomes", () => {
    const model = { ...initialModel(), assets: [video] };
    const [deletedModel] = update(model, SucceededDeleteAsset({ id: video.id }));
    const [failedModel] = update(model, FailedDeleteAsset({ error: "Delete failed" }));

    expect(deletedModel.assets).toEqual([]);
    expect(failedModel.errorMessage).toEqual(Option.some("Delete failed"));
  });

  test("confirms unpublish and applies its outcomes", () => {
    const publishedAsset = { ...video, publishedAt: 1_750_000_002_000 };
    const model = {
      ...initialModel(),
      screen: EditAsset({ assetId: video.id }),
      assets: [publishedAsset],
      editAsset: Option.some(publishedAsset),
    };
    const [pendingModel] = update(model, ClickedUnpublish({ id: video.id }));
    const [confirmedModel, commands] = update(pendingModel, ClickedConfirmPendingAction());

    expect(confirmedModel.isUnpublishing).toBe(true);
    expect(commands.map((command) => command.name)).toContain("UnpublishAsset");

    const [unpublishedModel] = update(
      confirmedModel,
      SucceededUnpublish({ video: { ...publishedAsset, publishedAt: null } }),
    );
    const [failedModel] = update(confirmedModel, FailedUnpublish({ error: "Unpublish failed" }));

    expect(unpublishedModel.isUnpublishing).toBe(false);
    expect(unpublishedModel.editAsset).toEqual(
      Option.some({ ...publishedAsset, publishedAt: null }),
    );
    expect(failedModel.isUnpublishing).toBe(false);
    expect(failedModel.errorMessage).toEqual(Option.some("Unpublish failed"));
  });

  test("authors, previews, and saves markdown content", () => {
    const markdownAsset: Asset = {
      ...video,
      id: "markdown-1",
      kind: "markdown",
      mediaKey: "media/markdown-1/content.md",
      durationSec: 0,
    };

    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: markdownAsset.id }),
        editAsset: Option.some(markdownAsset),
      }),
      Story.message(UpdatedMarkdownBody({ body: "# Hello" })),
      Story.model((model) => expect(model.markdownBody).toBe("# Hello")),
      Story.message(ToggledMarkdownPreview()),
      Story.model((model) => expect(model.markdownPreviewOpen).toBe(true)),
      Story.message(ClickedSaveMarkdown()),
      Story.model((model) => expect(model.markdownSaveStatus).toEqual({ _tag: "MarkdownSaving" })),
      Story.Command.expectExact(SaveMarkdownCmd({ id: markdownAsset.id, body: "# Hello" })),
      Story.Command.resolve(
        SaveMarkdownCmd,
        GotMarkdownSaved({ result: { _tag: "Success", video: markdownAsset } }),
      ),
      Story.model((model) => {
        expect(model.markdownSaveStatus).toEqual({ _tag: "MarkdownSaved" });
        expect(model.editAsset).toEqual(Option.some(markdownAsset));
      }),
    );
  });

  test("surfaces markdown save failures", () => {
    const markdownAsset: Asset = {
      ...video,
      id: "markdown-2",
      kind: "markdown",
      mediaKey: "media/markdown-2/content.md",
      durationSec: 0,
    };

    Story.story(
      update,
      Story.with({
        ...initialModel(),
        screen: EditAsset({ assetId: markdownAsset.id }),
        editAsset: Option.some(markdownAsset),
        markdownBody: "# Draft",
      }),
      Story.message(ClickedSaveMarkdown()),
      Story.Command.resolve(
        SaveMarkdownCmd,
        GotMarkdownSaved({ result: { _tag: "Failure", error: "Save failed" } }),
      ),
      Story.model((model) =>
        expect(model.markdownSaveStatus).toEqual({
          _tag: "MarkdownSaveFailed",
          error: "Save failed",
        }),
      ),
    );
  });
});

import { Match as M, Option } from "effect";
import { Dialog, FileDrop } from "@foldkit/ui";
import { Command } from "foldkit";
import { makeConstrainedEvo } from "foldkit/struct";
import { currentChapterStartSec } from "./chapterPlayback";
import { chaptersValidationError, clampToDuration, parseTimestamp, sortChapters } from "./chapters";
import {
  DeleteAssetConfirmation,
  EditAsset,
  initialModel,
  ListAssets,
  UnpublishAssetConfirmation,
  type Chapter,
  type Model,
  type PendingConfirmation,
  type Asset,
} from "./model";
import {
  GotConfirmationDialogMessage,
  GotPosterFileDropMessage,
  GotAssetFileDropMessage,
  type Message,
} from "./message";
import {
  CopyLinkCmd,
  CreateAssetCmd,
  DeleteAssetCmd,
  FocusChapterTitle,
  GenerateChapterId,
  LoadAssetDetail,
  LoadAssets,
  PublishAssetCmd,
  SaveChaptersCmd,
  SaveAssetCmd,
  UnpublishAssetCmd,
  UploadAssetCmd,
} from "./commands";

type Cmd = Command.Command<Message>;
type Update = readonly [Model, ReadonlyArray<Cmd>];

type Patch = Partial<{
  [K in keyof Model]: (a: Model[K]) => Model[K];
}>;

const evoModel = makeConstrainedEvo<Model>();

const noCmd = (m: Model): Update => [m, []];
const withCmds = (m: Model, ...cmds: ReadonlyArray<Cmd>): Update => [m, cmds];
const withEvo = (model: Model, patch: Patch, ...cmds: ReadonlyArray<Cmd>): Update => [
  evoModel(model, patch),
  cmds,
];

export const init = (): Update => [initialModel(), [LoadAssets()]];

const sameChapters = (left: ReadonlyArray<Chapter>, right: ReadonlyArray<Chapter>): boolean =>
  left.length === right.length &&
  left.every((chapter, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      chapter.id === other.id &&
      chapter.assetId === other.assetId &&
      chapter.title === other.title &&
      chapter.startSec === other.startSec &&
      chapter.sortOrder === other.sortOrder
    );
  });

const validationErrorWithDrafts = (
  model: Model,
  chapters: ReadonlyArray<Chapter>,
  drafts: Readonly<Record<string, string>> = model.chapterStartDrafts,
): Option.Option<string> => {
  const durationSec = Option.isSome(model.editAsset) ? model.editAsset.value.durationSec : 0;
  if (Object.values(drafts).some((draft) => Option.isNone(parseTimestamp(draft)))) {
    return Option.some("Timestamp must look like 0:45, 1:02:30, or a number of seconds");
  }
  const candidates = chapters.map((chapter) => {
    const draft = drafts[chapter.id];
    if (draft === undefined) {
      return chapter;
    }
    const parsed = parseTimestamp(draft);
    return Option.isSome(parsed)
      ? { ...chapter, startSec: clampToDuration(parsed.value, durationSec) }
      : chapter;
  });
  return chaptersValidationError(candidates);
};

const startChapterSave = (model: Model): Update => {
  if (Option.isNone(model.editAsset)) {
    return noCmd(model);
  }
  const validationError = validationErrorWithDrafts(model, model.editChapters);
  if (Option.isSome(validationError)) {
    return withEvo(model, {
      chapterSaveInFlight: () => false,
      chapterSaveQueued: () => false,
      chapterValidationError: () => validationError,
    });
  }
  return withEvo(
    model,
    {
      chapterSaveInFlight: () => true,
      chapterSaveQueued: () => false,
      chapterSaveSnapshot: () => model.editChapters,
      chapterValidationError: () => Option.none(),
    },
    SaveChaptersCmd({ id: model.editAsset.value.id, chapters: model.editChapters }),
  );
};

const saveChapters = (model: Model, chapters: ReadonlyArray<Chapter>): Update => {
  const sorted = sortChapters(chapters);
  const nextModel = evoModel(model, { editChapters: () => sorted });
  const validationError = validationErrorWithDrafts(model, sorted);
  if (model.chapterSaveInFlight) {
    return withEvo(nextModel, {
      chapterSaveQueued: () => !sameChapters(sorted, model.chapterSaveSnapshot),
      chapterValidationError: () => validationError,
    });
  }
  if (Option.isSome(validationError)) {
    return withEvo(nextModel, { chapterValidationError: () => validationError });
  }
  return startChapterSave(nextModel);
};

const withoutDraft = (
  drafts: Readonly<Record<string, string>>,
  id: string,
): Readonly<Record<string, string>> => {
  const { [id]: _removed, ...rest } = drafts;
  return rest;
};

const commitChapterStart = (model: Model, id: string, startSec: number): Update => {
  const chapter = model.editChapters.find((candidate) => candidate.id === id);
  if (!chapter) {
    return noCmd(model);
  }
  if (chapter.startSec === startSec) {
    const drafts = withoutDraft(model.chapterStartDrafts, id);
    return withEvo(model, {
      chapterStartDrafts: () => drafts,
      chapterValidationError: () => validationErrorWithDrafts(model, model.editChapters, drafts),
    });
  }
  const chapters = model.editChapters.map((candidate) =>
    candidate.id === id ? { ...candidate, startSec } : candidate,
  );
  const validationError = chaptersValidationError(chapters);
  if (Option.isSome(validationError)) {
    return withEvo(model, { chapterValidationError: () => validationError });
  }
  const [nextModel, cmds] = saveChapters(model, chapters);
  return [
    evoModel(nextModel, { chapterStartDrafts: () => withoutDraft(model.chapterStartDrafts, id) }),
    cmds,
  ];
};

const openConfirmation = (model: Model, pendingConfirmation: PendingConfirmation): Update => {
  const [confirmationDialog, commands] = Dialog.open(model.confirmationDialog);
  return withEvo(
    model,
    {
      confirmationDialog: () => confirmationDialog,
      pendingConfirmation: () => Option.some(pendingConfirmation),
    },
    ...Command.mapMessages(commands, (message) => GotConfirmationDialogMessage({ message })),
  );
};

export const update: (model: Model, message: Message) => Update = (model, message) =>
  M.value(message).pipe(
    M.withReturnType<Update>(),
    M.tagsExhaustive({
      ClickedEditAsset: (msg: { id: string }) =>
        model.isUploading
          ? noCmd(model)
          : withEvo(
              model,
              {
                screen: () => EditAsset({ assetId: msg.id }),
                editTitle: () => "",
                editDescription: () => "",
                editAsset: () => Option.none(),
                editChapters: () => [],
                chapterStartDrafts: () => ({}),
                chapterValidationError: () => Option.none(),
                chapterSaveInFlight: () => false,
                chapterSaveQueued: () => false,
                chapterSaveSnapshot: () => [],
                copiedLink: () => false,
                errorMessage: () => Option.none(),
              },
              LoadAssetDetail({ id: msg.id }),
            ),
      ClickedBack: () => {
        if (model.isUploading) {
          return noCmd(model);
        }
        return withEvo(model, {
          screen: () => ListAssets(),
          editTitle: () => "",
          editDescription: () => "",
          editAsset: () => Option.none(),
          editChapters: () => [],
          chapterStartDrafts: () => ({}),
          chapterValidationError: () => Option.none(),
          chapterSaveInFlight: () => false,
          chapterSaveQueued: () => false,
          chapterSaveSnapshot: () => [],
          selectedFile: () => Option.none(),
          selectedPoster: () => Option.none(),
          copiedLink: () => false,
          errorMessage: () => Option.none(),
        });
      },
      UpdatedTitle: (msg: { title: string }) => withEvo(model, { editTitle: () => msg.title }),
      UpdatedDescription: (msg: { description: string }) =>
        withEvo(model, { editDescription: () => msg.description }),
      BlurredEditField: () => {
        if (Option.isNone(model.editAsset)) {
          return noCmd(model);
        }
        const video = model.editAsset.value;
        const unchanged =
          model.editTitle === video.title && model.editDescription === (video.description ?? "");
        if (unchanged || model.editTitle.trim() === "") {
          return noCmd(model);
        }
        return withCmds(
          model,
          SaveAssetCmd({
            id: video.id,
            title: model.editTitle,
            description: model.editDescription,
          }),
        );
      },
      SucceededSaveAsset: (msg: { video: Asset }) =>
        withEvo(model, {
          editAsset: () => Option.some(msg.video),
          assets: () => model.assets.map((v) => (v.id === msg.video.id ? msg.video : v)),
        }),
      FailedSaveAsset: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SubmittedCreateAsset: () =>
        withEvo(model, { errorMessage: () => Option.none() }, CreateAssetCmd()),
      SucceededCreateAsset: (msg: { video: Asset }) =>
        withEvo(model, {
          assets: () => [msg.video, ...model.assets],
          screen: () => EditAsset({ assetId: msg.video.id }),
          editTitle: () => msg.video.title,
          editDescription: () => msg.video.description ?? "",
          editAsset: () => Option.some(msg.video),
        }),
      FailedCreateAsset: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SucceededLoadAssets: (msg) => withEvo(model, { assets: () => msg.assets }),
      FailedLoadAssets: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      GotAssetFileDropMessage: ({ message }) => {
        const [videoFileDrop, commands, maybeOutMessage] = FileDrop.update(
          model.videoFileDrop,
          message,
        );
        const selectedFile = Option.match(maybeOutMessage, {
          onNone: () => model.selectedFile,
          onSome: (outMessage) =>
            outMessage._tag === "ReceivedFiles"
              ? Option.some(outMessage.files[0])
              : model.selectedFile,
        });
        const errorMessage = Option.match(maybeOutMessage, {
          onNone: () => model.errorMessage,
          onSome: (outMessage) =>
            outMessage._tag === "RejectedNonFiles"
              ? Option.some("Please select a video or audio file")
              : Option.none(),
        });
        return withEvo(
          model,
          {
            videoFileDrop: () => videoFileDrop,
            selectedFile: () => selectedFile,
            errorMessage: () => errorMessage,
          },
          ...Command.mapMessages(commands, (message) => GotAssetFileDropMessage({ message })),
        );
      },
      GotPosterFileDropMessage: ({ message }) => {
        const [posterFileDrop, commands, maybeOutMessage] = FileDrop.update(
          model.posterFileDrop,
          message,
        );
        const selectedPoster = Option.match(maybeOutMessage, {
          onNone: () => model.selectedPoster,
          onSome: (outMessage) =>
            outMessage._tag === "ReceivedFiles"
              ? Option.some(outMessage.files[0])
              : model.selectedPoster,
        });
        const errorMessage = Option.match(maybeOutMessage, {
          onNone: () => model.errorMessage,
          onSome: (outMessage) =>
            outMessage._tag === "RejectedNonFiles"
              ? Option.some("Please select an image file")
              : Option.none(),
        });
        return withEvo(
          model,
          {
            posterFileDrop: () => posterFileDrop,
            selectedPoster: () => selectedPoster,
            errorMessage: () => errorMessage,
          },
          ...Command.mapMessages(commands, (message) => GotPosterFileDropMessage({ message })),
        );
      },
      ClearedPoster: () => withEvo(model, { selectedPoster: () => Option.none() }),
      SubmittedUpload: () => {
        if (Option.isNone(model.selectedFile)) {
          return withEvo(model, {
            errorMessage: () => Option.some("Please select a file first"),
          });
        }
        if (model.screen._tag !== "EditAsset") {
          return withEvo(model, {
            errorMessage: () =>
              Option.some("Save the asset before uploading to create a stable identifier"),
          });
        }
        const assetId = model.screen.assetId;
        return withEvo(
          model,
          {
            isUploading: () => true,
            uploadingAssetId: () => Option.some(assetId),
            uploadStage: () => "uploading",
            uploadPct: () => 0,
            errorMessage: () => Option.none(),
          },
          UploadAssetCmd({
            assetId,
            file: model.selectedFile.value,
            poster: model.selectedPoster,
          }),
        );
      },
      ReceivedUploadProgress: (msg: { stage: string; pct: number }) =>
        withEvo(model, {
          uploadStage: () => msg.stage,
          uploadPct: () => msg.pct,
        }),
      SucceededUpload: (msg: { video: Asset }) => {
        return withEvo(model, {
          isUploading: () => false,
          uploadingAssetId: () => Option.none(),
          uploadStage: () => "done",
          uploadPct: () => 100,
          editAsset: () => Option.some(msg.video),
          assets: () =>
            model.assets.map((asset) => (asset.id === msg.video.id ? msg.video : asset)),
          selectedFile: () => Option.none(),
          selectedPoster: () => Option.none(),
        });
      },
      FailedUpload: (msg: { error: string }) => {
        return withEvo(model, {
          isUploading: () => false,
          uploadingAssetId: () => Option.none(),
          uploadStage: () => "",
          uploadPct: () => 0,
          errorMessage: () => Option.some(msg.error),
        });
      },
      FailedUploadProgress: ({ error }) =>
        withEvo(model, { errorMessage: () => Option.some(error) }),
      ClickedPublish: (msg: { id: string }) =>
        withEvo(
          model,
          {
            isPublishing: () => true,
            errorMessage: () => Option.none(),
          },
          PublishAssetCmd({ id: msg.id }),
        ),
      SucceededPublish: (msg: { video: Asset }) =>
        withEvo(model, {
          isPublishing: () => false,
          editAsset: () => Option.some(msg.video),
          assets: () => model.assets.map((v) => (v.id === msg.video.id ? msg.video : v)),
        }),
      FailedPublish: (msg: { error: string }) =>
        withEvo(model, {
          isPublishing: () => false,
          errorMessage: () => Option.some(msg.error),
        }),
      ClickedUnpublish: ({ id }) =>
        openConfirmation(model, UnpublishAssetConfirmation({ assetId: id })),
      GotConfirmationDialogMessage: ({ message }) => {
        const [confirmationDialog, commands, maybeOutMessage] = Dialog.update(
          model.confirmationDialog,
          message,
        );
        return withEvo(
          model,
          {
            confirmationDialog: () => confirmationDialog,
            pendingConfirmation: () =>
              Option.isSome(maybeOutMessage) && maybeOutMessage.value._tag === "Closed"
                ? Option.none()
                : model.pendingConfirmation,
          },
          ...Command.mapMessages(commands, (message) => GotConfirmationDialogMessage({ message })),
        );
      },
      ClickedConfirmPendingAction: () => {
        if (Option.isNone(model.pendingConfirmation)) {
          return noCmd(model);
        }
        const pendingConfirmation = model.pendingConfirmation.value;
        const [confirmationDialog, dialogCommands] = Dialog.close(model.confirmationDialog);
        const commands = Command.mapMessages(dialogCommands, (message) =>
          GotConfirmationDialogMessage({ message }),
        );
        if (pendingConfirmation._tag === "DeleteAssetConfirmation") {
          return withEvo(
            model,
            {
              confirmationDialog: () => confirmationDialog,
              pendingConfirmation: () => Option.none(),
            },
            ...commands,
            DeleteAssetCmd({ id: pendingConfirmation.assetId }),
          );
        }
        return withEvo(
          model,
          {
            confirmationDialog: () => confirmationDialog,
            pendingConfirmation: () => Option.none(),
            isUnpublishing: () => true,
            errorMessage: () => Option.none(),
          },
          ...commands,
          UnpublishAssetCmd({ id: pendingConfirmation.assetId }),
        );
      },
      SucceededUnpublish: (msg: { video: Asset }) =>
        withEvo(model, {
          isUnpublishing: () => false,
          editAsset: () => Option.some(msg.video),
          assets: () => model.assets.map((v) => (v.id === msg.video.id ? msg.video : v)),
        }),
      FailedUnpublish: (msg: { error: string }) =>
        withEvo(model, {
          isUnpublishing: () => false,
          errorMessage: () => Option.some(msg.error),
        }),
      ClickedDeleteAsset: ({ id }) =>
        openConfirmation(model, DeleteAssetConfirmation({ assetId: id })),
      SucceededDeleteAsset: (msg: { id: string }) => {
        const removed = model.assets.find((v) => v.id === msg.id);
        const nextScreen =
          model.screen._tag === "EditAsset" && model.screen.assetId === msg.id
            ? ListAssets()
            : model.screen;
        const assets = removed ? model.assets.filter((v) => v.id !== msg.id) : model.assets;
        const next =
          removed || nextScreen !== model.screen
            ? withEvo(model, { assets: () => assets, screen: () => nextScreen })
            : noCmd(model);
        return next;
      },
      FailedDeleteAsset: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SucceededLoadAssetDetail: (msg: { video: Asset; chapters: ReadonlyArray<Chapter> }) =>
        withEvo(model, {
          editAsset: () => Option.some(msg.video),
          editTitle: () => msg.video.title,
          editDescription: () => msg.video.description ?? "",
          editChapters: () => sortChapters(msg.chapters),
          chapterStartDrafts: () => ({}),
          chapterValidationError: () => Option.none(),
          chapterSaveInFlight: () => false,
          chapterSaveQueued: () => false,
          chapterSaveSnapshot: () => [],
        }),
      FailedLoadAssetDetail: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      ClickedAddChapter: () => {
        if (Option.isNone(model.editAsset) || model.editAsset.value.mediaKey === "") {
          return noCmd(model);
        }
        return withCmds(
          model,
          GenerateChapterId({
            assetId: model.editAsset.value.id,
            startSec: currentChapterStartSec(),
          }),
        );
      },
      GeneratedChapterId: ({ chapterId, assetId, startSec }) => {
        if (Option.isNone(model.editAsset) || model.editAsset.value.id !== assetId) {
          return noCmd(model);
        }
        const newChapter: Chapter = {
          id: chapterId,
          assetId,
          title: "",
          startSec: clampToDuration(startSec, model.editAsset.value.durationSec),
          sortOrder: model.editChapters.length,
        };
        return withEvo(
          model,
          { editChapters: () => sortChapters([...model.editChapters, newChapter]) },
          FocusChapterTitle({ chapterId }),
        );
      },
      FocusedChapterTitle: () => noCmd(model),
      ClickedRemoveChapter: (msg: { id: string }) => {
        const next = model.editChapters.filter((c) => c.id !== msg.id);
        const [nextModel, cmds] = saveChapters(model, next);
        return [
          evoModel(nextModel, {
            chapterStartDrafts: () => withoutDraft(model.chapterStartDrafts, msg.id),
          }),
          cmds,
        ];
      },
      UpdatedChapterTitle: (msg: { id: string; title: string }) => {
        const chapters = model.editChapters.map((c) =>
          c.id === msg.id ? { ...c, title: msg.title } : c,
        );
        return withEvo(model, {
          editChapters: () => chapters,
          chapterSaveQueued: () =>
            model.chapterSaveInFlight
              ? !sameChapters(chapters, model.chapterSaveSnapshot)
              : model.chapterSaveQueued,
          chapterValidationError: () => validationErrorWithDrafts(model, chapters),
        });
      },
      UpdatedChapterStart: (msg: { id: string; value: string }) =>
        withEvo(model, {
          chapterStartDrafts: () => ({ ...model.chapterStartDrafts, [msg.id]: msg.value }),
        }),
      CommittedChapterStart: (msg: { id: string }) => {
        const draft = model.chapterStartDrafts[msg.id];
        if (draft === undefined || Option.isNone(model.editAsset)) {
          return noCmd(model);
        }
        const parsed = parseTimestamp(draft);
        if (Option.isNone(parsed)) {
          return withEvo(model, {
            chapterValidationError: () =>
              Option.some("Timestamp must look like 0:45, 1:02:30, or a number of seconds"),
          });
        }
        return commitChapterStart(
          model,
          msg.id,
          clampToDuration(parsed.value, model.editAsset.value.durationSec),
        );
      },
      ClickedSetChapterToPlayhead: (msg: { id: string }) => {
        if (Option.isNone(model.editAsset)) {
          return noCmd(model);
        }
        return commitChapterStart(
          model,
          msg.id,
          clampToDuration(currentChapterStartSec(), model.editAsset.value.durationSec),
        );
      },
      BlurredChapterField: () => saveChapters(model, model.editChapters),
      SucceededSaveChapters: (msg: { chapters: ReadonlyArray<Chapter> }) =>
        model.chapterSaveQueued
          ? startChapterSave(model)
          : withEvo(model, {
              editChapters: () => sortChapters(msg.chapters),
              chapterSaveInFlight: () => false,
              chapterSaveSnapshot: () => [],
              chapterValidationError: () => Option.none(),
            }),
      FailedSaveChapters: (msg: { error: string }) =>
        model.chapterSaveQueued
          ? startChapterSave(model)
          : withEvo(model, {
              chapterSaveInFlight: () => false,
              chapterSaveSnapshot: () => [],
              errorMessage: () => Option.some(msg.error),
            }),
      ClickedCopyLink: (msg: { url: string }) => withCmds(model, CopyLinkCmd({ url: msg.url })),
      CopiedLink: () => withEvo(model, { copiedLink: () => true }),
      FailedCopyLink: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
    }),
  );

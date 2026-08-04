import { Match as M, Option } from "effect";
import { Dialog, FileDrop } from "@foldkit/ui";
import { Command } from "foldkit";
import { makeConstrainedEvo } from "foldkit/struct";
import { currentChapterStartSec } from "./chapterPlayback";
import { chaptersValidationError, clampToDuration, parseTimestamp, sortChapters } from "./chapters";
import {
  DeleteVideoConfirmation,
  EditVideo,
  initialModel,
  ListVideos,
  UnpublishVideoConfirmation,
  type Chapter,
  type Model,
  type PendingConfirmation,
  type Video,
} from "./model";
import {
  GotConfirmationDialogMessage,
  GotPosterFileDropMessage,
  GotVideoFileDropMessage,
  type Message,
} from "./message";
import {
  CopyLinkCmd,
  CreateVideoCmd,
  DeleteVideoCmd,
  FocusChapterTitle,
  GenerateChapterId,
  LoadVideoDetail,
  LoadVideos,
  PublishVideoCmd,
  SaveChaptersCmd,
  SaveVideoCmd,
  UnpublishVideoCmd,
  UploadVideoCmd,
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

export const init = (): Update => [initialModel(), [LoadVideos()]];

const saveChapters = (model: Model, chapters: ReadonlyArray<Chapter>): Update => {
  const sorted = sortChapters(chapters);
  const nextModel = evoModel(model, { editChapters: () => sorted });
  if (Option.isNone(model.editVideo)) {
    return noCmd(nextModel);
  }
  const validationError = chaptersValidationError(sorted);
  if (Option.isSome(validationError)) {
    return withEvo(nextModel, { chapterValidationError: () => validationError });
  }
  return withEvo(
    nextModel,
    { chapterValidationError: () => Option.none() },
    SaveChaptersCmd({ id: model.editVideo.value.id, chapters: sorted }),
  );
};

const withoutDraft = (
  drafts: Readonly<Record<string, string>>,
  id: string,
): Readonly<Record<string, string>> => {
  const { [id]: _removed, ...rest } = drafts;
  return rest;
};

const commitChapterStart = (model: Model, id: string, startSec: number): Update => {
  const chapters = model.editChapters.map((chapter) =>
    chapter.id === id ? { ...chapter, startSec } : chapter,
  );
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
      ClickedEditVideo: (msg: { id: string }) =>
        model.isUploading
          ? noCmd(model)
          : withEvo(
              model,
              {
                screen: () => EditVideo({ videoId: msg.id }),
                editTitle: () => "",
                editDescription: () => "",
                editVideo: () => Option.none(),
                editChapters: () => [],
                chapterStartDrafts: () => ({}),
                chapterValidationError: () => Option.none(),
                copiedLink: () => false,
                errorMessage: () => Option.none(),
              },
              LoadVideoDetail({ id: msg.id }),
            ),
      ClickedBack: () => {
        if (model.isUploading) {
          return noCmd(model);
        }
        return withEvo(model, {
          screen: () => ListVideos(),
          editTitle: () => "",
          editDescription: () => "",
          editVideo: () => Option.none(),
          editChapters: () => [],
          chapterStartDrafts: () => ({}),
          chapterValidationError: () => Option.none(),
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
        if (Option.isNone(model.editVideo)) {
          return noCmd(model);
        }
        const video = model.editVideo.value;
        const unchanged =
          model.editTitle === video.title && model.editDescription === (video.description ?? "");
        if (unchanged || model.editTitle.trim() === "") {
          return noCmd(model);
        }
        return withCmds(
          model,
          SaveVideoCmd({
            id: video.id,
            title: model.editTitle,
            description: model.editDescription,
          }),
        );
      },
      SucceededSaveVideo: (msg: { video: Video }) =>
        withEvo(model, {
          editVideo: () => Option.some(msg.video),
          videos: () => model.videos.map((v) => (v.id === msg.video.id ? msg.video : v)),
        }),
      FailedSaveVideo: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SubmittedCreateVideo: () =>
        withEvo(model, { errorMessage: () => Option.none() }, CreateVideoCmd()),
      SucceededCreateVideo: (msg: { video: Video }) =>
        withEvo(model, {
          videos: () => [msg.video, ...model.videos],
          screen: () => EditVideo({ videoId: msg.video.id }),
          editTitle: () => msg.video.title,
          editDescription: () => msg.video.description ?? "",
          editVideo: () => Option.some(msg.video),
        }),
      FailedCreateVideo: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SucceededLoadVideos: (msg) => withEvo(model, { videos: () => msg.videos }),
      FailedLoadVideos: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      GotVideoFileDropMessage: ({ message }) => {
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
          ...Command.mapMessages(commands, (message) => GotVideoFileDropMessage({ message })),
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
        if (model.screen._tag !== "EditVideo") {
          return withEvo(model, {
            errorMessage: () =>
              Option.some("Save the video before uploading to create a stable identifier"),
          });
        }
        const videoId = model.screen.videoId;
        return withEvo(
          model,
          {
            isUploading: () => true,
            uploadingVideoId: () => Option.some(videoId),
            uploadStage: () => "uploading",
            uploadPct: () => 0,
            errorMessage: () => Option.none(),
          },
          UploadVideoCmd({
            videoId,
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
      SucceededUpload: (msg: { video: Video }) => {
        return withEvo(model, {
          isUploading: () => false,
          uploadingVideoId: () => Option.none(),
          uploadStage: () => "done",
          uploadPct: () => 100,
          editVideo: () => Option.some(msg.video),
          selectedFile: () => Option.none(),
          selectedPoster: () => Option.none(),
        });
      },
      FailedUpload: (msg: { error: string }) => {
        return withEvo(model, {
          isUploading: () => false,
          uploadingVideoId: () => Option.none(),
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
          PublishVideoCmd({ id: msg.id }),
        ),
      SucceededPublish: (msg: { video: Video }) =>
        withEvo(model, {
          isPublishing: () => false,
          editVideo: () => Option.some(msg.video),
          videos: () => model.videos.map((v) => (v.id === msg.video.id ? msg.video : v)),
        }),
      FailedPublish: (msg: { error: string }) =>
        withEvo(model, {
          isPublishing: () => false,
          errorMessage: () => Option.some(msg.error),
        }),
      ClickedUnpublish: ({ id }) =>
        openConfirmation(model, UnpublishVideoConfirmation({ videoId: id })),
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
        if (pendingConfirmation._tag === "DeleteVideoConfirmation") {
          return withEvo(
            model,
            {
              confirmationDialog: () => confirmationDialog,
              pendingConfirmation: () => Option.none(),
            },
            ...commands,
            DeleteVideoCmd({ id: pendingConfirmation.videoId }),
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
          UnpublishVideoCmd({ id: pendingConfirmation.videoId }),
        );
      },
      SucceededUnpublish: (msg: { video: Video }) =>
        withEvo(model, {
          isUnpublishing: () => false,
          editVideo: () => Option.some(msg.video),
          videos: () => model.videos.map((v) => (v.id === msg.video.id ? msg.video : v)),
        }),
      FailedUnpublish: (msg: { error: string }) =>
        withEvo(model, {
          isUnpublishing: () => false,
          errorMessage: () => Option.some(msg.error),
        }),
      ClickedDeleteVideo: ({ id }) =>
        openConfirmation(model, DeleteVideoConfirmation({ videoId: id })),
      SucceededDeleteVideo: (msg: { id: string }) => {
        const removed = model.videos.find((v) => v.id === msg.id);
        const nextScreen =
          model.screen._tag === "EditVideo" && model.screen.videoId === msg.id
            ? ListVideos()
            : model.screen;
        const videos = removed ? model.videos.filter((v) => v.id !== msg.id) : model.videos;
        const next =
          removed || nextScreen !== model.screen
            ? withEvo(model, { videos: () => videos, screen: () => nextScreen })
            : noCmd(model);
        return next;
      },
      FailedDeleteVideo: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SucceededLoadVideoDetail: (msg: { video: Video; chapters: ReadonlyArray<Chapter> }) =>
        withEvo(model, {
          editVideo: () => Option.some(msg.video),
          editTitle: () => msg.video.title,
          editDescription: () => msg.video.description ?? "",
          editChapters: () => sortChapters(msg.chapters),
          chapterStartDrafts: () => ({}),
          chapterValidationError: () => Option.none(),
        }),
      FailedLoadVideoDetail: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      ClickedAddChapter: () => {
        if (Option.isNone(model.editVideo)) {
          return noCmd(model);
        }
        return withCmds(
          model,
          GenerateChapterId({
            videoId: model.editVideo.value.id,
            startSec: currentChapterStartSec(),
          }),
        );
      },
      GeneratedChapterId: ({ chapterId, videoId, startSec }) => {
        if (Option.isNone(model.editVideo) || model.editVideo.value.id !== videoId) {
          return noCmd(model);
        }
        const newChapter: Chapter = {
          id: chapterId,
          videoId,
          title: "",
          startSec: clampToDuration(startSec, model.editVideo.value.durationSec),
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
          chapterValidationError: () => chaptersValidationError(chapters),
        });
      },
      UpdatedChapterStart: (msg: { id: string; value: string }) =>
        withEvo(model, {
          chapterStartDrafts: () => ({ ...model.chapterStartDrafts, [msg.id]: msg.value }),
        }),
      CommittedChapterStart: (msg: { id: string }) => {
        const draft = model.chapterStartDrafts[msg.id];
        if (draft === undefined || Option.isNone(model.editVideo)) {
          return noCmd(model);
        }
        const parsed = parseTimestamp(draft);
        if (Option.isNone(parsed)) {
          return withEvo(model, {
            chapterStartDrafts: () => withoutDraft(model.chapterStartDrafts, msg.id),
            chapterValidationError: () =>
              Option.some("Timestamp must look like 0:45, 1:02:30, or a number of seconds"),
          });
        }
        return commitChapterStart(
          model,
          msg.id,
          clampToDuration(parsed.value, model.editVideo.value.durationSec),
        );
      },
      ClickedSetChapterToPlayhead: (msg: { id: string }) => {
        if (Option.isNone(model.editVideo)) {
          return noCmd(model);
        }
        return commitChapterStart(
          model,
          msg.id,
          clampToDuration(currentChapterStartSec(), model.editVideo.value.durationSec),
        );
      },
      BlurredChapterField: () => saveChapters(model, model.editChapters),
      SucceededSaveChapters: (msg: { chapters: ReadonlyArray<Chapter> }) =>
        withEvo(model, {
          editChapters: () => sortChapters(msg.chapters),
          chapterValidationError: () => Option.none(),
        }),
      FailedSaveChapters: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      ClickedCopyLink: (msg: { url: string }) => withCmds(model, CopyLinkCmd({ url: msg.url })),
      CopiedLink: () => withEvo(model, { copiedLink: () => true }),
      FailedCopyLink: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
    }),
  );

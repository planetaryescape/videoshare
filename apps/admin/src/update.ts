import { Match as M, Option } from "effect";
import { FileDrop } from "@foldkit/ui";
import { Command } from "foldkit";
import { makeConstrainedEvo } from "foldkit/struct";
import { EditVideo, initialModel, ListVideos, type Chapter, type Model, type Video } from "./model";
import { GotPosterFileDropMessage, GotVideoFileDropMessage, type Message } from "./message";
import {
  CopyLinkCmd,
  CreateVideoCmd,
  DeleteVideoCmd,
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
  const nextModel = evoModel(model, { editChapters: () => chapters });
  if (Option.isNone(model.editVideo)) {
    return noCmd(nextModel);
  }
  if (chapters.some((c) => c.title.trim() === "")) {
    return withEvo(nextModel, {
      chapterValidationError: () => Option.some("Every chapter needs a title before saving"),
    });
  }
  return withEvo(
    nextModel,
    { chapterValidationError: () => Option.none() },
    SaveChaptersCmd({ id: model.editVideo.value.id, chapters }),
  );
};

export const update: (model: Model, message: Message) => Update = (model, message) =>
  M.value(message).pipe(
    M.withReturnType<Update>(),
    M.tagsExhaustive({
      ClickedEditVideo: (msg: { id: string }) =>
        withEvo(
          model,
          {
            screen: () => EditVideo({ videoId: msg.id }),
            editTitle: () => "",
            editDescription: () => "",
            editVideo: () => Option.none(),
            editChapters: () => [],
            chapterValidationError: () => Option.none(),
            copiedLink: () => false,
            errorMessage: () => Option.none(),
          },
          LoadVideoDetail({ id: msg.id }),
        ),
      ClickedBack: () => {
        return withEvo(model, {
          screen: () => ListVideos(),
          editTitle: () => "",
          editDescription: () => "",
          editVideo: () => Option.none(),
          editChapters: () => [],
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
        return withEvo(
          model,
          {
            isUploading: () => true,
            uploadStage: () => "uploading",
            uploadPct: () => 0,
            errorMessage: () => Option.none(),
          },
          UploadVideoCmd({
            videoId: model.screen.videoId,
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
          uploadStage: () => "",
          uploadPct: () => 0,
          errorMessage: () => Option.some(msg.error),
        });
      },
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
      ClickedUnpublish: (msg: { id: string }) => {
        if (
          !window.confirm(
            "Unpublish this video? It will be taken offline. Local data and R2 media will be removed; you can re-publish from the local files later.",
          )
        ) {
          return noCmd(model);
        }
        return withEvo(
          model,
          {
            isUnpublishing: () => true,
            errorMessage: () => Option.none(),
          },
          UnpublishVideoCmd({ id: msg.id }),
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
      ClickedDeleteVideo: (msg: { id: string }) => {
        if (!window.confirm("Delete this video?")) {
          return noCmd(model);
        }
        return withCmds(model, DeleteVideoCmd({ id: msg.id }));
      },
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
          editChapters: () => msg.chapters,
          chapterValidationError: () => Option.none(),
        }),
      FailedLoadVideoDetail: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      ClickedAddChapter: () => {
        if (Option.isNone(model.editVideo)) {
          return noCmd(model);
        }
        return withCmds(model, GenerateChapterId({ videoId: model.editVideo.value.id }));
      },
      GeneratedChapterId: ({ chapterId, videoId }) => {
        if (Option.isNone(model.editVideo) || model.editVideo.value.id !== videoId) {
          return noCmd(model);
        }
        const newChapter: Chapter = {
          id: chapterId,
          videoId,
          title: "",
          startSec: 0,
          sortOrder: model.editChapters.length,
        };
        return withEvo(model, {
          editChapters: () => [...model.editChapters, newChapter],
        });
      },
      ClickedRemoveChapter: (msg: { id: string }) => {
        const next = model.editChapters.filter((c) => c.id !== msg.id);
        return saveChapters(model, next);
      },
      UpdatedChapterTitle: (msg: { id: string; title: string }) =>
        withEvo(model, {
          editChapters: () =>
            model.editChapters.map((c) => (c.id === msg.id ? { ...c, title: msg.title } : c)),
          chapterValidationError: () =>
            model.editChapters.every(
              (chapter) => (chapter.id === msg.id ? msg.title : chapter.title).trim() !== "",
            )
              ? Option.none()
              : model.chapterValidationError,
        }),
      UpdatedChapterStart: (msg: { id: string; startSec: number }) =>
        withEvo(model, {
          editChapters: () =>
            model.editChapters.map((c) => (c.id === msg.id ? { ...c, startSec: msg.startSec } : c)),
        }),
      BlurredChapterField: () => saveChapters(model, model.editChapters),
      SucceededSaveChapters: (msg: { chapters: ReadonlyArray<Chapter> }) =>
        withEvo(model, {
          editChapters: () => msg.chapters,
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

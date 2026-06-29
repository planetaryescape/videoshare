import { Match as M, Option, Schema as S } from "effect";
import type { Command } from "foldkit";
import { makeConstrainedEvo } from "foldkit/struct";
import { initialModel, type Chapter, type Model, type Video } from "./model";
import { ReceivedUploadProgress, type Message } from "./message";
import {
  CopyLinkCmd,
  CreateVideoCmd,
  DeleteVideoCmd,
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

const ListVideosScreen = (): { _tag: "ListVideos" } => ({ _tag: "ListVideos" });
const EditVideoScreen = (videoId: string): { _tag: "EditVideo"; videoId: string } => ({
  _tag: "EditVideo",
  videoId,
});

export const init = (): Update => [initialModel(), [LoadVideos()]];

export const PROGRESS_EVENT = "videoshare:upload-progress";

let progressSocket: WebSocket | null = null;

const ProgressFrame = S.Struct({
  stage: S.String,
  pct: S.Finite.check(S.isBetween({ minimum: 0, maximum: 100 })),
});
const decodeFrame = S.decodeUnknownOption(S.fromJsonString(ProgressFrame));

const WS_ORIGIN = `ws://${location.hostname}:3001`;

const openProgressSocket = (videoId: string) => {
  if (progressSocket && progressSocket.readyState <= WebSocket.OPEN) {
    progressSocket.close();
  }
  const ws = new WebSocket(`${WS_ORIGIN}/ws?videoId=${encodeURIComponent(videoId)}`);
  ws.addEventListener("message", (event) => {
    const decoded = decodeFrame(event.data);
    if (Option.isSome(decoded)) {
      window.dispatchEvent(
        new CustomEvent(PROGRESS_EVENT, {
          detail: ReceivedUploadProgress({
            stage: decoded.value.stage,
            pct: decoded.value.pct,
          }),
        }),
      );
    }
  });
  progressSocket = ws;
};

const closeProgressSocket = () => {
  if (progressSocket) {
    progressSocket.close();
    progressSocket = null;
  }
};

const saveChaptersCmd = (model: Model, chapters: ReadonlyArray<Chapter>): ReadonlyArray<Cmd> => {
  if (Option.isNone(model.editVideo)) {
    return [];
  }
  if (chapters.some((c) => c.title.trim() === "")) {
    return [];
  }
  return [SaveChaptersCmd({ id: model.editVideo.value.id, chapters })];
};

export const update: (model: Model, message: Message) => Update = (model, message) =>
  M.value(message).pipe(
    M.withReturnType<Update>(),
    M.tagsExhaustive({
      ClickedNewVideo: () =>
        withEvo(model, {
          screen: () => EditVideoScreen(""),
          editTitle: () => "",
          editDescription: () => "",
          editVideo: () => Option.none(),
          editChapters: () => [],
          selectedFile: () => null,
          copiedLink: () => false,
          errorMessage: () => Option.none(),
        }),
      ClickedEditVideo: (msg: { id: string }) =>
        withEvo(
          model,
          {
            screen: () => EditVideoScreen(msg.id),
            editTitle: () => "",
            editDescription: () => "",
            editVideo: () => Option.none(),
            editChapters: () => [],
            copiedLink: () => false,
            errorMessage: () => Option.none(),
          },
          LoadVideoDetail({ id: msg.id }),
        ),
      ClickedBack: () => {
        closeProgressSocket();
        return withEvo(model, {
          screen: () => ListVideosScreen(),
          editTitle: () => "",
          editDescription: () => "",
          editVideo: () => Option.none(),
          editChapters: () => [],
          selectedFile: () => null,
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
          screen: () => EditVideoScreen(msg.video.id),
          editTitle: () => msg.video.title,
          editDescription: () => msg.video.description ?? "",
          editVideo: () => Option.some(msg.video),
        }),
      FailedCreateVideo: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SucceededLoadVideos: (msg) => withEvo(model, { videos: () => msg.videos }),
      FailedLoadVideos: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SelectedFile: (msg: { file: File }) =>
        withEvo(model, { selectedFile: () => msg.file ?? null }),
      SubmittedUpload: () => {
        if (!model.selectedFile) {
          return withEvo(model, {
            errorMessage: () => Option.some("Please select a file first"),
          });
        }
        if (model.screen._tag !== "EditVideo") {
          return noCmd(model);
        }
        openProgressSocket(model.screen.videoId);
        return withEvo(
          model,
          {
            isUploading: () => true,
            uploadStage: () => "uploading",
            uploadPct: () => 0,
            errorMessage: () => Option.none(),
          },
          UploadVideoCmd({ videoId: model.screen.videoId, file: model.selectedFile }),
        );
      },
      ReceivedUploadProgress: (msg: { stage: string; pct: number }) =>
        withEvo(model, {
          uploadStage: () => msg.stage,
          uploadPct: () => msg.pct,
        }),
      SucceededUpload: (msg: { video: Video }) => {
        closeProgressSocket();
        return withEvo(model, {
          isUploading: () => false,
          uploadStage: () => "done",
          uploadPct: () => 100,
          editVideo: () => Option.some(msg.video),
          selectedFile: () => null,
        });
      },
      FailedUpload: (msg: { error: string }) => {
        closeProgressSocket();
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
        return withEvo(
          model,
          {
            videos: () => model.videos.filter((v) => v.id !== msg.id),
            screen: () =>
              model.screen._tag === "EditVideo" && model.screen.videoId === msg.id
                ? ListVideosScreen()
                : model.screen,
          },
          DeleteVideoCmd({ id: msg.id }),
        );
      },
      SucceededDeleteVideo: () => noCmd(model),
      FailedDeleteVideo: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      SucceededLoadVideoDetail: (msg: { video: Video; chapters: ReadonlyArray<Chapter> }) =>
        withEvo(model, {
          editVideo: () => Option.some(msg.video),
          editTitle: () => msg.video.title,
          editDescription: () => msg.video.description ?? "",
          editChapters: () => msg.chapters,
        }),
      FailedLoadVideoDetail: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      ClickedAddChapter: () => {
        const newChapter: Chapter = {
          id: crypto.randomUUID(),
          videoId: Option.isSome(model.editVideo) ? model.editVideo.value.id : "",
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
        return withEvo(model, { editChapters: () => next }, ...saveChaptersCmd(model, next));
      },
      UpdatedChapterTitle: (msg: { id: string; title: string }) =>
        withEvo(model, {
          editChapters: () =>
            model.editChapters.map((c) => (c.id === msg.id ? { ...c, title: msg.title } : c)),
        }),
      UpdatedChapterStart: (msg: { id: string; startSec: number }) =>
        withEvo(model, {
          editChapters: () =>
            model.editChapters.map((c) => (c.id === msg.id ? { ...c, startSec: msg.startSec } : c)),
        }),
      BlurredChapterField: () => withCmds(model, ...saveChaptersCmd(model, model.editChapters)),
      SucceededSaveChapters: (msg: { chapters: ReadonlyArray<Chapter> }) =>
        withEvo(model, { editChapters: () => msg.chapters }),
      FailedSaveChapters: (msg: { error: string }) =>
        withEvo(model, { errorMessage: () => Option.some(msg.error) }),
      ClickedCopyLink: (msg: { url: string }) => withCmds(model, CopyLinkCmd({ url: msg.url })),
      CopiedLink: () => withEvo(model, { copiedLink: () => true }),
    }),
  );

import { Match as M, Option } from "effect";
import type { Command } from "foldkit";
import { evo } from "foldkit/struct";
import { initialModel, type Chapter, type Model, type Video } from "./model";
import type { Message } from "./message";
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

export const init = (): Update => [initialModel(), [LoadVideos()]];

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
        [
          evo(model, {
            screen: () => ({ _tag: "EditVideo" as const, videoId: "" }),
            editTitle: () => "",
            editDescription: () => "",
            editVideo: () => Option.none(),
            editChapters: () => [],
            selectedFile: () => null,
            copiedLink: () => false,
            errorMessage: () => Option.none(),
          }),
          [],
        ] as const,
      ClickedEditVideo: (msg: { id: string }) =>
        [
          evo(model, {
            screen: () => ({ _tag: "EditVideo" as const, videoId: msg.id }),
            editTitle: () => "",
            editDescription: () => "",
            editVideo: () => Option.none(),
            editChapters: () => [],
            copiedLink: () => false,
            errorMessage: () => Option.none(),
          }),
          [LoadVideoDetail({ id: msg.id })],
        ] as const,
      ClickedBack: () =>
        [
          evo(model, {
            screen: () => ({ _tag: "ListVideos" as const }),
            editTitle: () => "",
            editDescription: () => "",
            editVideo: () => Option.none(),
            editChapters: () => [],
            selectedFile: () => null,
            copiedLink: () => false,
            errorMessage: () => Option.none(),
          }),
          [],
        ] as const,
      UpdatedTitle: (msg: { title: string }) =>
        [evo(model, { editTitle: () => msg.title }), []] as const,
      UpdatedDescription: (msg: { description: string }) =>
        [evo(model, { editDescription: () => msg.description }), []] as const,
      BlurredEditField: () => {
        if (Option.isNone(model.editVideo)) {
          return [model, []] as const;
        }
        const video = model.editVideo.value;
        const unchanged =
          model.editTitle === video.title && model.editDescription === (video.description ?? "");
        if (unchanged || model.editTitle.trim() === "") {
          return [model, []] as const;
        }
        return [
          model,
          [
            SaveVideoCmd({
              id: video.id,
              title: model.editTitle,
              description: model.editDescription,
            }),
          ],
        ] as const;
      },
      SucceededSaveVideo: (msg: { video: Video }) =>
        [
          evo(model, {
            editVideo: () => Option.some(msg.video),
            videos: () => model.videos.map((v) => (v.id === msg.video.id ? msg.video : v)),
          }),
          [],
        ] as const,
      FailedSaveVideo: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      SubmittedCreateVideo: () =>
        [evo(model, { errorMessage: () => Option.none() }), [CreateVideoCmd()]] as const,
      SucceededCreateVideo: (msg: { video: Video }) =>
        [
          evo(model, {
            videos: () => [msg.video, ...model.videos],
            screen: () => ({ _tag: "EditVideo" as const, videoId: msg.video.id }),
            editTitle: () => msg.video.title,
            editDescription: () => msg.video.description ?? "",
            editVideo: () => Option.some(msg.video),
          }),
          [],
        ] as const,
      FailedCreateVideo: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      SucceededLoadVideos: (msg) => [evo(model, { videos: () => msg.videos }), []] as const,
      FailedLoadVideos: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      SelectedFile: (msg: { file: File }) =>
        [evo(model, { selectedFile: () => msg.file ?? null }), []] as const,
      SubmittedUpload: () => {
        if (!model.selectedFile) {
          return [
            evo(model, { errorMessage: () => Option.some("Please select a file first") }),
            [],
          ] as const;
        }
        if (model.screen._tag !== "EditVideo") {
          return [model, []] as const;
        }
        return [
          evo(model, {
            isUploading: () => true,
            uploadStage: () => "uploading",
            uploadPct: () => 0,
            errorMessage: () => Option.none(),
          }),
          [UploadVideoCmd({ videoId: model.screen.videoId, file: model.selectedFile })],
        ] as const;
      },
      ReceivedUploadProgress: (msg: { stage: string; pct: number }) =>
        [
          evo(model, {
            uploadStage: () => msg.stage,
            uploadPct: () => msg.pct,
          }),
          [],
        ] as const,
      SucceededUpload: (msg: { video: Video }) =>
        [
          evo(model, {
            isUploading: () => false,
            uploadStage: () => "done",
            uploadPct: () => 100,
            editVideo: () => Option.some(msg.video),
            selectedFile: () => null,
          }),
          [],
        ] as const,
      FailedUpload: (msg: { error: string }) =>
        [
          evo(model, {
            isUploading: () => false,
            uploadStage: () => "",
            uploadPct: () => 0,
            errorMessage: () => Option.some(msg.error),
          }),
          [],
        ] as const,
      ClickedPublish: (msg: { id: string }) =>
        [
          evo(model, {
            isPublishing: () => true,
            errorMessage: () => Option.none(),
          }),
          [PublishVideoCmd({ id: msg.id })],
        ] as const,
      SucceededPublish: (msg: { video: Video }) =>
        [
          evo(model, {
            isPublishing: () => false,
            editVideo: () => Option.some(msg.video),
            videos: () => model.videos.map((v) => (v.id === msg.video.id ? msg.video : v)),
          }),
          [],
        ] as const,
      FailedPublish: (msg: { error: string }) =>
        [
          evo(model, {
            isPublishing: () => false,
            errorMessage: () => Option.some(msg.error),
          }),
          [],
        ] as const,
      ClickedUnpublish: (msg: { id: string }) => {
        if (
          !window.confirm(
            "Unpublish this video? It will be taken offline. Local data and R2 media will be removed; you can re-publish from the local files later.",
          )
        ) {
          return [model, []] as const;
        }
        return [
          evo(model, {
            isUnpublishing: () => true,
            errorMessage: () => Option.none(),
          }),
          [UnpublishVideoCmd({ id: msg.id })],
        ] as const;
      },
      SucceededUnpublish: (msg: { video: Video }) =>
        [
          evo(model, {
            isUnpublishing: () => false,
            editVideo: () => Option.some(msg.video),
            videos: () => model.videos.map((v) => (v.id === msg.video.id ? msg.video : v)),
          }),
          [],
        ] as const,
      FailedUnpublish: (msg: { error: string }) =>
        [
          evo(model, {
            isUnpublishing: () => false,
            errorMessage: () => Option.some(msg.error),
          }),
          [],
        ] as const,
      ClickedDeleteVideo: (msg: { id: string }) => {
        if (!window.confirm("Delete this video?")) {
          return [model, []] as const;
        }
        return [
          evo(model, {
            videos: () => model.videos.filter((v) => v.id !== msg.id),
            screen: () =>
              model.screen._tag === "EditVideo" && model.screen.videoId === msg.id
                ? ({ _tag: "ListVideos" } as const)
                : model.screen,
          }),
          [DeleteVideoCmd({ id: msg.id })],
        ] as const;
      },
      SucceededDeleteVideo: () => [model, []] as const,
      FailedDeleteVideo: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      SucceededLoadVideoDetail: (msg: { video: Video; chapters: ReadonlyArray<Chapter> }) =>
        [
          evo(model, {
            editVideo: () => Option.some(msg.video),
            editTitle: () => msg.video.title,
            editDescription: () => msg.video.description ?? "",
            editChapters: () => msg.chapters,
          }),
          [],
        ] as const,
      FailedLoadVideoDetail: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      ClickedAddChapter: () => {
        const newChapter: Chapter = {
          id: crypto.randomUUID(),
          videoId: Option.isSome(model.editVideo) ? model.editVideo.value.id : "",
          title: "",
          startSec: 0,
          sortOrder: model.editChapters.length,
        };
        return [
          evo(model, { editChapters: () => [...model.editChapters, newChapter] }),
          [],
        ] as const;
      },
      ClickedRemoveChapter: (msg: { id: string }) => {
        const next = model.editChapters.filter((c) => c.id !== msg.id);
        return [evo(model, { editChapters: () => next }), saveChaptersCmd(model, next)] as const;
      },
      UpdatedChapterTitle: (msg: { id: string; title: string }) =>
        [
          evo(model, {
            editChapters: () =>
              model.editChapters.map((c) => (c.id === msg.id ? { ...c, title: msg.title } : c)),
          }),
          [],
        ] as const,
      UpdatedChapterStart: (msg: { id: string; startSec: number }) =>
        [
          evo(model, {
            editChapters: () =>
              model.editChapters.map((c) =>
                c.id === msg.id ? { ...c, startSec: msg.startSec } : c,
              ),
          }),
          [],
        ] as const,
      BlurredChapterField: () => [model, saveChaptersCmd(model, model.editChapters)] as const,
      SucceededSaveChapters: (msg: { chapters: ReadonlyArray<Chapter> }) =>
        [evo(model, { editChapters: () => msg.chapters }), []] as const,
      FailedSaveChapters: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      ClickedCopyLink: (msg: { url: string }) => [model, [CopyLinkCmd({ url: msg.url })]] as const,
      CopiedLink: () => [evo(model, { copiedLink: () => true }), []] as const,
    }),
  );

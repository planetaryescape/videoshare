import { Schema as S, Option } from "effect";
import { File as FoldkitFile } from "foldkit";
import { ts } from "foldkit/schema";
import { Dialog, FileDrop } from "@foldkit/ui";

export const VideoSchema = S.Struct({
  id: S.String,
  slug: S.String,
  kind: S.Literals(["video", "audio"]),
  title: S.String,
  description: S.NullOr(S.String),
  posterKey: S.NullOr(S.String),
  hlsKey: S.String,
  durationSec: S.Finite,
  createdAt: S.Finite,
  publishedAt: S.NullOr(S.Finite),
  updatedAt: S.NullOr(S.Finite),
});
export type Video = typeof VideoSchema.Type;

export const ChapterSchema = S.Struct({
  id: S.String,
  videoId: S.String,
  title: S.String,
  startSec: S.Finite.check(S.isGreaterThanOrEqualTo(0)),
  sortOrder: S.Int.check(S.isGreaterThanOrEqualTo(0)),
});
export type Chapter = typeof ChapterSchema.Type;

export const ListVideos = ts("ListVideos");
export const EditVideo = ts("EditVideo", {
  videoId: S.String.check(S.isMinLength(1)),
});
export const Screen = S.Union([ListVideos, EditVideo]);
export const DeleteVideoConfirmation = ts("DeleteVideoConfirmation", { videoId: S.String });
export const UnpublishVideoConfirmation = ts("UnpublishVideoConfirmation", { videoId: S.String });
export const PendingConfirmation = S.Union([DeleteVideoConfirmation, UnpublishVideoConfirmation]);
export type PendingConfirmation = typeof PendingConfirmation.Type;

export const Model = S.Struct({
  screen: Screen,
  videos: S.Array(VideoSchema),
  editTitle: S.String,
  editDescription: S.String,
  editVideo: S.Option(VideoSchema),
  editChapters: S.Array(ChapterSchema),
  chapterStartDrafts: S.Record(S.String, S.String),
  chapterValidationError: S.Option(S.String),
  videoFileDrop: FileDrop.Model,
  posterFileDrop: FileDrop.Model,
  confirmationDialog: Dialog.Model,
  pendingConfirmation: S.Option(PendingConfirmation),
  selectedFile: S.Option(FoldkitFile.File),
  selectedPoster: S.Option(FoldkitFile.File),
  isUploading: S.Boolean,
  uploadingVideoId: S.Option(S.String),
  uploadStage: S.String,
  uploadPct: S.Finite,
  isPublishing: S.Boolean,
  isUnpublishing: S.Boolean,
  copiedLink: S.Boolean,
  errorMessage: S.Option(S.String),
});
export type Model = typeof Model.Type;

export const initialModel = (): Model => ({
  screen: ListVideos(),
  videos: [],
  editTitle: "",
  editDescription: "",
  editVideo: Option.none(),
  editChapters: [],
  chapterStartDrafts: {},
  chapterValidationError: Option.none(),
  videoFileDrop: FileDrop.init({ id: "video-file" }),
  posterFileDrop: FileDrop.init({ id: "poster-file" }),
  confirmationDialog: Dialog.init({ id: "video-action-confirmation" }),
  pendingConfirmation: Option.none(),
  selectedFile: Option.none(),
  selectedPoster: Option.none(),
  isUploading: false,
  uploadingVideoId: Option.none(),
  uploadStage: "",
  uploadPct: 0,
  isPublishing: false,
  isUnpublishing: false,
  copiedLink: false,
  errorMessage: Option.none(),
});

export const VIEWER_BASE = "https://video.planetaryescape.co.za";

export const shareUrl = (slug: string): string => `${VIEWER_BASE}/${slug}`;

export const errMsg = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const formatDuration = (sec: number): string => {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const formatDate = (ts: number): string => new Date(ts).toLocaleDateString();

export const isPublished = (video: Video): boolean => video.publishedAt !== null;

export const hasUnpublishedChanges = (video: Video): boolean => {
  if (video.updatedAt === null) {
    return false;
  }
  return video.publishedAt === null || video.updatedAt > video.publishedAt;
};

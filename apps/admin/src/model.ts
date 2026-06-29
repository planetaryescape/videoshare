import { Schema as S, Option } from "effect";

export type Video = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly posterKey: string | null;
  readonly hlsKey: string;
  readonly durationSec: number;
  readonly createdAt: number;
  readonly publishedAt: number | null;
  readonly updatedAt: number | null;
};

export const VideoSchema = S.Struct({
  id: S.String,
  slug: S.String,
  title: S.String,
  description: S.NullOr(S.String),
  posterKey: S.NullOr(S.String),
  hlsKey: S.String,
  durationSec: S.Finite,
  createdAt: S.Finite,
  publishedAt: S.NullOr(S.Finite),
  updatedAt: S.NullOr(S.Finite),
});

export type Chapter = {
  readonly id: string;
  readonly videoId: string;
  readonly title: string;
  readonly startSec: number;
  readonly sortOrder: number;
};

export const ChapterSchema = S.Struct({
  id: S.String,
  videoId: S.String,
  title: S.String,
  startSec: S.Finite,
  sortOrder: S.Finite,
});

export const Model = S.Struct({
  screen: S.Union([
    S.TaggedStruct("ListVideos", {}),
    S.TaggedStruct("EditVideo", { videoId: S.String }),
  ]),
  videos: S.Array(VideoSchema),
  editTitle: S.String,
  editDescription: S.String,
  editVideo: S.Option(VideoSchema),
  editChapters: S.Array(ChapterSchema),
  selectedFile: S.Any,
  isUploading: S.Boolean,
  uploadStage: S.String,
  uploadPct: S.Finite,
  isPublishing: S.Boolean,
  isUnpublishing: S.Boolean,
  copiedLink: S.Boolean,
  errorMessage: S.Option(S.String),
});
export type Model = {
  readonly screen: { _tag: "ListVideos" } | { _tag: "EditVideo"; videoId: string };
  readonly videos: ReadonlyArray<Video>;
  readonly editTitle: string;
  readonly editDescription: string;
  readonly editVideo: Option.Option<Video>;
  readonly editChapters: ReadonlyArray<Chapter>;
  readonly selectedFile: File | null;
  readonly isUploading: boolean;
  readonly uploadStage: string;
  readonly uploadPct: number;
  readonly isPublishing: boolean;
  readonly isUnpublishing: boolean;
  readonly copiedLink: boolean;
  readonly errorMessage: Option.Option<string>;
};

export const initialModel = (): Model => ({
  screen: { _tag: "ListVideos" },
  videos: [],
  editTitle: "",
  editDescription: "",
  editVideo: Option.none(),
  editChapters: [],
  selectedFile: null,
  isUploading: false,
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

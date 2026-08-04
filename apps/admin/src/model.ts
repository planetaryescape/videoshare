import { Schema as S, Option } from "effect";
import { File as FoldkitFile } from "foldkit";
import { ts } from "foldkit/schema";
import { Dialog, FileDrop } from "@foldkit/ui";

export const AssetSchema = S.Struct({
  id: S.String,
  slug: S.String,
  kind: S.Literals(["video", "audio"]),
  title: S.String,
  description: S.NullOr(S.String),
  posterKey: S.NullOr(S.String),
  mediaKey: S.String,
  durationSec: S.Finite,
  createdAt: S.Finite,
  publishedAt: S.NullOr(S.Finite),
  updatedAt: S.NullOr(S.Finite),
});
export type Asset = typeof AssetSchema.Type;

export const ChapterSchema = S.Struct({
  id: S.String,
  assetId: S.String,
  title: S.String,
  startSec: S.Finite.check(S.isGreaterThanOrEqualTo(0)),
  sortOrder: S.Int.check(S.isGreaterThanOrEqualTo(0)),
});
export type Chapter = typeof ChapterSchema.Type;

export const ListAssets = ts("ListAssets");
export const EditAsset = ts("EditAsset", {
  assetId: S.String.check(S.isMinLength(1)),
});
export const Screen = S.Union([ListAssets, EditAsset]);
export const DeleteAssetConfirmation = ts("DeleteAssetConfirmation", { assetId: S.String });
export const UnpublishAssetConfirmation = ts("UnpublishAssetConfirmation", { assetId: S.String });
export const PendingConfirmation = S.Union([DeleteAssetConfirmation, UnpublishAssetConfirmation]);
export type PendingConfirmation = typeof PendingConfirmation.Type;

export const Model = S.Struct({
  screen: Screen,
  assets: S.Array(AssetSchema),
  editTitle: S.String,
  editDescription: S.String,
  editAsset: S.Option(AssetSchema),
  editChapters: S.Array(ChapterSchema),
  chapterStartDrafts: S.Record(S.String, S.String),
  chapterValidationError: S.Option(S.String),
  chapterSaveInFlight: S.Boolean,
  chapterSaveQueued: S.Boolean,
  chapterSaveSnapshot: S.Array(ChapterSchema),
  videoFileDrop: FileDrop.Model,
  posterFileDrop: FileDrop.Model,
  confirmationDialog: Dialog.Model,
  pendingConfirmation: S.Option(PendingConfirmation),
  selectedFile: S.Option(FoldkitFile.File),
  selectedPoster: S.Option(FoldkitFile.File),
  isUploading: S.Boolean,
  uploadingAssetId: S.Option(S.String),
  uploadStage: S.String,
  uploadPct: S.Finite,
  isPublishing: S.Boolean,
  isUnpublishing: S.Boolean,
  copiedLink: S.Boolean,
  errorMessage: S.Option(S.String),
});
export type Model = typeof Model.Type;

export const initialModel = (): Model => ({
  screen: ListAssets(),
  assets: [],
  editTitle: "",
  editDescription: "",
  editAsset: Option.none(),
  editChapters: [],
  chapterStartDrafts: {},
  chapterValidationError: Option.none(),
  chapterSaveInFlight: false,
  chapterSaveQueued: false,
  chapterSaveSnapshot: [],
  videoFileDrop: FileDrop.init({ id: "video-file" }),
  posterFileDrop: FileDrop.init({ id: "poster-file" }),
  confirmationDialog: Dialog.init({ id: "video-action-confirmation" }),
  pendingConfirmation: Option.none(),
  selectedFile: Option.none(),
  selectedPoster: Option.none(),
  isUploading: false,
  uploadingAssetId: Option.none(),
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

export const isPublished = (video: Asset): boolean => video.publishedAt !== null;

export const hasUnpublishedChanges = (video: Asset): boolean => {
  if (video.updatedAt === null) {
    return false;
  }
  return video.publishedAt === null || video.updatedAt > video.publishedAt;
};

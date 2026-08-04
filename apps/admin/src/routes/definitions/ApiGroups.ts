import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { Multipart } from "effect/unstable/http";
import { Chapter, Asset, AssetId } from "@videoshare/shared/Asset";
import {
  PersistenceError,
  ProdSyncError,
  SlugAlreadyExistsError,
  AssetNotFoundError,
  ImageChaptersNotAllowedError,
  InvalidMediaShapeError,
} from "@videoshare/shared/AssetErrors";
import { StorageError } from "../../errors/StorageErrors.ts";
import {
  InvalidConversionError,
  NoAssetTrackError,
  PosterDecodeError,
  TranscodeError,
} from "../../errors/TranscodeErrors.ts";
import { NotTranscodedError, UploadValidationError } from "../../errors/UploadErrors.ts";
import { InvalidImageError, UnsupportedMediaError } from "../../errors/MediaErrors.ts";
import {
  ChapterInput,
  CreateAssetRequest,
  DeleteResponse,
  UpdateAssetRequest,
  AssetListResponse,
  AssetWithChapters,
} from "../../schemas/Requests.ts";

const IdParam = Schema.Struct({ id: Schema.String });

const Asset201 = Asset.pipe(HttpApiSchema.status(201));

export class AssetsApi extends HttpApiGroup.make("assets")
  .add(
    HttpApiEndpoint.get("listAssets", "/", {
      success: AssetListResponse,
      error: PersistenceError,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAsset", "/:id", {
      params: IdParam,
      success: AssetWithChapters,
      error: [AssetNotFoundError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.post("createAsset", "/", {
      payload: CreateAssetRequest,
      success: Asset201,
      error: [SlugAlreadyExistsError, InvalidMediaShapeError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.put("updateAsset", "/:id", {
      params: IdParam,
      payload: UpdateAssetRequest,
      success: AssetWithChapters,
      error: [AssetNotFoundError, ImageChaptersNotAllowedError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteAsset", "/:id", {
      params: IdParam,
      success: DeleteResponse,
      error: [AssetNotFoundError, PersistenceError, StorageError, ProdSyncError],
    }),
  )
  .prefix("/assets") {}

export class UploadApi extends HttpApiGroup.make("upload")
  .add(
    HttpApiEndpoint.post("upload", "/", {
      payload: Schema.Struct({
        assetId: Schema.String,
        file: Multipart.SingleFileSchema,
      }).pipe(HttpApiSchema.asMultipart()),
      success: Asset,
      error: [
        UploadValidationError,
        AssetNotFoundError,
        NoAssetTrackError,
        PosterDecodeError,
        TranscodeError,
        InvalidConversionError,
        InvalidImageError,
        UnsupportedMediaError,
        InvalidMediaShapeError,
        ProdSyncError,
        PersistenceError,
        StorageError,
      ],
    }),
  )
  .prefix("/upload") {}

export class PublishApi extends HttpApiGroup.make("publish")
  .add(
    HttpApiEndpoint.post("publish", "/:id", {
      params: IdParam,
      success: Asset,
      error: [
        AssetNotFoundError,
        NotTranscodedError,
        ProdSyncError,
        PersistenceError,
        StorageError,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("unpublish", "/:id/unpublish", {
      params: IdParam,
      success: Asset,
      error: [AssetNotFoundError, ProdSyncError, PersistenceError],
    }),
  )
  .prefix("/publish") {}

export class ChaptersApi extends HttpApiGroup.make("chapters")
  .add(
    HttpApiEndpoint.put("replaceChapters", "/:assetId", {
      params: Schema.Struct({ assetId: AssetId }),
      payload: Schema.Array(ChapterInput),
      success: Schema.Array(Chapter),
      error: [AssetNotFoundError, ImageChaptersNotAllowedError, PersistenceError],
    }),
  )
  .prefix("/assets") {}

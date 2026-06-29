import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { Multipart } from "effect/unstable/http";
import { Chapter, Video, VideoId } from "@videoshare/shared/Video";
import {
  PersistenceError,
  ProdSyncError,
  SlugAlreadyExistsError,
  VideoNotFoundError,
} from "@videoshare/shared/VideoErrors";
import { StorageError } from "../../errors/StorageErrors.ts";
import {
  InvalidConversionError,
  NoVideoTrackError,
  PosterDecodeError,
  TranscodeError,
} from "../../errors/TranscodeErrors.ts";
import { NotTranscodedError, UploadValidationError } from "../../errors/UploadErrors.ts";
import {
  ChapterInput,
  CreateVideoRequest,
  DeleteResponse,
  UpdateVideoRequest,
  VideoListResponse,
  VideoWithChapters,
} from "../../schemas/Requests.ts";

const IdParam = Schema.Struct({ id: Schema.String });

const Video201 = Video.pipe(HttpApiSchema.status(201));

export class VideosApi extends HttpApiGroup.make("videos")
  .add(
    HttpApiEndpoint.get("listVideos", "/", {
      success: VideoListResponse,
      error: PersistenceError,
    }),
  )
  .add(
    HttpApiEndpoint.get("getVideo", "/:id", {
      params: IdParam,
      success: VideoWithChapters,
      error: [VideoNotFoundError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.post("createVideo", "/", {
      payload: CreateVideoRequest,
      success: Video201,
      error: [SlugAlreadyExistsError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.put("updateVideo", "/:id", {
      params: IdParam,
      payload: UpdateVideoRequest,
      success: VideoWithChapters,
      error: [VideoNotFoundError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteVideo", "/:id", {
      params: IdParam,
      success: DeleteResponse,
      error: [VideoNotFoundError, PersistenceError, StorageError, ProdSyncError],
    }),
  )
  .prefix("/videos") {}

export class UploadApi extends HttpApiGroup.make("upload")
  .add(
    HttpApiEndpoint.post("upload", "/", {
      payload: Schema.Struct({
        videoId: Schema.String,
        file: Multipart.SingleFileSchema,
      }).pipe(HttpApiSchema.asMultipart()),
      success: Video,
      error: [
        UploadValidationError,
        VideoNotFoundError,
        NoVideoTrackError,
        PosterDecodeError,
        TranscodeError,
        InvalidConversionError,
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
      success: Video,
      error: [
        VideoNotFoundError,
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
      success: Video,
      error: [VideoNotFoundError, ProdSyncError, PersistenceError],
    }),
  )
  .prefix("/publish") {}

export class ChaptersApi extends HttpApiGroup.make("chapters")
  .add(
    HttpApiEndpoint.put("replaceChapters", "/videos/:videoId", {
      params: Schema.Struct({ videoId: VideoId }),
      payload: Schema.Array(ChapterInput),
      success: Schema.Array(Chapter),
      error: [VideoNotFoundError, PersistenceError],
    }),
  )
  .prefix("/videos") {}

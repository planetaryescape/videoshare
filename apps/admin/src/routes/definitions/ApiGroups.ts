import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { Multipart } from "effect/unstable/http";
import { Asset, AssetId } from "@videoshare/shared/Asset";
import {
  PersistenceError,
  ProdSyncError,
  AssetPublicationValidationError,
  SlugAlreadyExistsError,
  AssetNotFoundError,
  ImageChaptersNotAllowedError,
  InvalidMediaShapeError,
  ProjectNotFoundError,
  InvalidProjectMembersError,
  ProjectPublicationValidationError,
  PublishedProjectMemberMutationError,
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
  CreateAssetRequest,
  DeleteResponse,
  UpdateAssetRequest,
  AssetListResponse,
  AssetWithChapters,
  ProjectListResponse,
  ProjectDetail,
  CreateProjectRequest,
  UpdateProjectRequest,
  ReplaceProjectMembersRequest,
  MoveProjectMemberRequest,
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
      error: [
        AssetNotFoundError,
        PublishedProjectMemberMutationError,
        PersistenceError,
        StorageError,
        ProdSyncError,
      ],
    }),
  )
  .prefix("/assets") {}

export class ProjectsApi extends HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("listProjects", "/", {
      success: ProjectListResponse,
      error: PersistenceError,
    }),
  )
  .add(
    HttpApiEndpoint.get("getProject", "/:id", {
      params: IdParam,
      success: ProjectDetail,
      error: [ProjectNotFoundError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.post("createProject", "/", {
      payload: CreateProjectRequest,
      success: ProjectDetail.pipe(HttpApiSchema.status(201)),
      error: [SlugAlreadyExistsError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.put("updateProject", "/:id", {
      params: IdParam,
      payload: UpdateProjectRequest,
      success: ProjectDetail,
      error: [ProjectNotFoundError, SlugAlreadyExistsError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.put("replaceMembers", "/:id/members", {
      params: IdParam,
      payload: ReplaceProjectMembersRequest,
      success: ProjectDetail,
      error: [ProjectNotFoundError, InvalidProjectMembersError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.post("moveMember", "/:id/members", {
      params: IdParam,
      payload: MoveProjectMemberRequest,
      success: ProjectDetail,
      error: [ProjectNotFoundError, InvalidProjectMembersError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("unfileMember", "/:id/members/:assetId", {
      params: Schema.Struct({ id: Schema.String, assetId: AssetId }),
      success: ProjectDetail,
      error: [ProjectNotFoundError, InvalidProjectMembersError, PersistenceError],
    }),
  )
  .add(
    HttpApiEndpoint.post("publishProject", "/:id/publish", {
      params: IdParam,
      success: DeleteResponse,
      error: [
        ProjectNotFoundError,
        ProjectPublicationValidationError,
        ProdSyncError,
        PersistenceError,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("unpublishProject", "/:id/publish", {
      params: IdParam,
      success: DeleteResponse,
      error: [ProjectNotFoundError, PersistenceError, ProdSyncError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteProject", "/:id", {
      params: IdParam,
      success: DeleteResponse,
      error: [ProjectNotFoundError, PersistenceError, ProdSyncError],
    }),
  )
  .prefix("/projects") {}

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
        AssetPublicationValidationError,
        InvalidMediaShapeError,
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
      error: [
        AssetNotFoundError,
        PublishedProjectMemberMutationError,
        ProdSyncError,
        PersistenceError,
      ],
    }),
  )
  .prefix("/publish") {}

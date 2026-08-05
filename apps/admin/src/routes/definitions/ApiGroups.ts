import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { Multipart } from "effect/unstable/http";
import { AssetId } from "@videoshare/shared/Asset";
import { BrowserProjectAsset } from "../../projects/contracts.ts";
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
  AssetIdPath,
  ProjectListResponse,
  ProjectDetail,
  CreateProjectRequest,
  UpdateProjectRequest,
  ReplaceProjectMembersRequest,
  MoveProjectMemberRequest,
} from "../../schemas/Requests.ts";

const IdParam = Schema.Struct({ id: Schema.String });

const Asset201 = BrowserProjectAsset.pipe(HttpApiSchema.status(201));

export class AssetsApi extends HttpApiGroup.make("assets")
  .add(
    HttpApiEndpoint.get("listAssets", "/", {
      success: AssetListResponse,
      error: PersistenceError,
    }),
  )
  .add(
    HttpApiEndpoint.get("getAsset", "/:id", {
      params: AssetIdPath,
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
      params: AssetIdPath,
      payload: UpdateAssetRequest,
      success: AssetWithChapters,
      error: [
        AssetNotFoundError,
        ImageChaptersNotAllowedError,
        SlugAlreadyExistsError,
        PersistenceError,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteAsset", "/:id", {
      params: AssetIdPath,
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
      error: [
        ProjectNotFoundError,
        ProjectPublicationValidationError,
        SlugAlreadyExistsError,
        PersistenceError,
      ],
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
      success: ProjectDetail,
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
      success: ProjectDetail,
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
        poster: Schema.optional(Multipart.SingleFileSchema),
      }).pipe(HttpApiSchema.asMultipart()),
      success: BrowserProjectAsset,
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
        PublishedProjectMemberMutationError,
        SlugAlreadyExistsError,
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
      params: AssetIdPath,
      success: BrowserProjectAsset,
      error: [
        AssetNotFoundError,
        AssetPublicationValidationError,
        InvalidMediaShapeError,
        NotTranscodedError,
        PublishedProjectMemberMutationError,
        SlugAlreadyExistsError,
        ProdSyncError,
        PersistenceError,
        StorageError,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("unpublish", "/:id/unpublish", {
      params: AssetIdPath,
      success: BrowserProjectAsset,
      error: [
        AssetNotFoundError,
        PublishedProjectMemberMutationError,
        SlugAlreadyExistsError,
        ProdSyncError,
        PersistenceError,
      ],
    }),
  )
  .prefix("/publish") {}

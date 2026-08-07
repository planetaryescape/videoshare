import { Schema } from "effect";

export class AssetNotFoundError extends Schema.TaggedErrorClass<AssetNotFoundError>()(
  "AssetNotFoundError",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Asset not found: ${this.id}`;
  }
}

export class PasswordRequiredError extends Schema.TaggedErrorClass<PasswordRequiredError>()(
  "PasswordRequiredError",
  { slug: Schema.String },
  { httpApiStatus: 401 },
) {
  override get message(): string {
    return `Password required for asset: ${this.slug}`;
  }
}

export class IncorrectPasswordError extends Schema.TaggedErrorClass<IncorrectPasswordError>()(
  "IncorrectPasswordError",
  { slug: Schema.String },
  { httpApiStatus: 403 },
) {
  override get message(): string {
    return `Incorrect password for asset: ${this.slug}`;
  }
}

export class SlugAlreadyExistsError extends Schema.TaggedErrorClass<SlugAlreadyExistsError>()(
  "SlugAlreadyExistsError",
  { slug: Schema.String },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `Slug already in use: ${this.slug}`;
  }
}

export class ImageChaptersNotAllowedError extends Schema.TaggedErrorClass<ImageChaptersNotAllowedError>()(
  "ImageChaptersNotAllowedError",
  { assetId: Schema.String, chapterCount: Schema.Int.check(Schema.isGreaterThan(0)) },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Image assets cannot have chapters: ${this.assetId}`;
  }
}

export class AssetKindMismatchError extends Schema.TaggedErrorClass<AssetKindMismatchError>()(
  "AssetKindMismatchError",
  {
    assetId: Schema.String,
    expectedKind: Schema.Literals(["video", "audio", "image", "markdown"]),
    actualKind: Schema.Literals(["video", "audio", "image", "markdown"]),
  },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Asset ${this.assetId} is ${this.actualKind}, expected ${this.expectedKind}`;
  }
}

export class InvalidMediaShapeError extends Schema.TaggedErrorClass<InvalidMediaShapeError>()(
  "InvalidMediaShapeError",
  {
    assetId: Schema.String,
    kind: Schema.Literals(["video", "audio", "image", "markdown"]),
    reason: Schema.Literals([
      "imageRequiresZeroDurationAndPositiveDimensions",
      "timedAssetsRequireNullDimensions",
      "markdownRequiresZeroDurationAndNullDimensions",
    ]),
  },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Invalid media shape for ${this.kind} asset: ${this.assetId} (${this.reason})`;
  }
}

export class ProjectNotFoundError extends Schema.TaggedErrorClass<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Project not found: ${this.id}`;
  }
}

export class InvalidProjectMembersError extends Schema.TaggedErrorClass<InvalidProjectMembersError>()(
  "InvalidProjectMembersError",
  { reason: Schema.Literals(["duplicateAssetId", "unknownAssetId", "notMemberOfProject"]) },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Invalid project members: ${this.reason}`;
  }
}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  { operation: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Persistence error during ${this.operation}`;
  }
}

export class AssetPublicationValidationError extends Schema.TaggedErrorClass<AssetPublicationValidationError>()(
  "AssetPublicationValidationError",
  { assetId: Schema.String, reason: Schema.Literals(["missingMediaKey"]) },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Asset cannot be published: ${this.assetId} (${this.reason})`;
  }
}

export class ProjectPublicationValidationError extends Schema.TaggedErrorClass<ProjectPublicationValidationError>()(
  "ProjectPublicationValidationError",
  {
    projectId: Schema.String,
    reason: Schema.Literals([
      "emptyProject",
      "missingMediaKey",
      "invalidMediaShape",
      "absoluteMediaKeyInProtectedProject",
      "publishedSlugChange",
    ]),
  },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Project cannot be published: ${this.projectId} (${this.reason})`;
  }
}

export class PublishedProjectMemberMutationError extends Schema.TaggedErrorClass<PublishedProjectMemberMutationError>()(
  "PublishedProjectMemberMutationError",
  {
    assetId: Schema.String,
    projectId: Schema.String,
    operation: Schema.Literals(["upload", "publish", "unpublish", "delete", "content"]),
  },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `Cannot ${this.operation} asset ${this.assetId}: it belongs to published project ${this.projectId}`;
  }
}

export class ProdSyncError extends Schema.TaggedErrorClass<ProdSyncError>()(
  "ProdSyncError",
  { operation: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 502 },
) {
  override get message(): string {
    return `Production sync failed during ${this.operation}`;
  }
}

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

export class InvalidMediaShapeError extends Schema.TaggedErrorClass<InvalidMediaShapeError>()(
  "InvalidMediaShapeError",
  {
    assetId: Schema.String,
    kind: Schema.Literals(["video", "audio", "image"]),
    reason: Schema.Literals([
      "imageRequiresZeroDurationAndPositiveDimensions",
      "timedAssetsRequireNullDimensions",
    ]),
  },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Invalid media shape for ${this.kind} asset: ${this.assetId} (${this.reason})`;
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

export class ProdSyncError extends Schema.TaggedErrorClass<ProdSyncError>()(
  "ProdSyncError",
  { operation: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 502 },
) {
  override get message(): string {
    return `Production sync failed during ${this.operation}`;
  }
}

export const errorStatus: Record<string, number> = {
  AssetNotFoundError: 404,
  PasswordRequiredError: 401,
  IncorrectPasswordError: 403,
  SlugAlreadyExistsError: 409,
  ImageChaptersNotAllowedError: 422,
  InvalidMediaShapeError: 422,
  PersistenceError: 500,
  ProdSyncError: 502,
};

export const statusForError = (error: { readonly _tag: string }): number =>
  errorStatus[error._tag] ?? 500;

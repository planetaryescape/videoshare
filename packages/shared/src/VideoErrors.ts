import { Schema } from "effect"

export class VideoNotFoundError extends Schema.TaggedErrorClass<VideoNotFoundError>()(
  "VideoNotFoundError",
  { slug: Schema.String }
) {
  override get message(): string {
    return `Video not found: ${this.slug}`
  }
}

export class PasswordRequiredError extends Schema.TaggedErrorClass<PasswordRequiredError>()(
  "PasswordRequiredError",
  { slug: Schema.String }
) {
  override get message(): string {
    return `Password required for video: ${this.slug}`
  }
}

export class IncorrectPasswordError extends Schema.TaggedErrorClass<IncorrectPasswordError>()(
  "IncorrectPasswordError",
  { slug: Schema.String }
) {
  override get message(): string {
    return `Incorrect password for video: ${this.slug}`
  }
}

export class SlugAlreadyExistsError extends Schema.TaggedErrorClass<SlugAlreadyExistsError>()(
  "SlugAlreadyExistsError",
  { slug: Schema.String }
) {
  override get message(): string {
    return `Slug already in use: ${this.slug}`
  }
}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  { operation: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Persistence error during ${this.operation}`
  }
}

export class ProdSyncError extends Schema.TaggedErrorClass<ProdSyncError>()(
  "ProdSyncError",
  { operation: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Production sync failed during ${this.operation}`
  }
}

export const errorStatus: Record<string, number> = {
  VideoNotFoundError: 404,
  PasswordRequiredError: 401,
  IncorrectPasswordError: 403,
  SlugAlreadyExistsError: 409,
  PersistenceError: 500,
  ProdSyncError: 502
}

export const statusForError = (error: { readonly _tag: string }): number =>
  errorStatus[error._tag] ?? 500

import { Schema } from "effect";

export class UploadValidationError extends Schema.TaggedErrorClass<UploadValidationError>()(
  "UploadValidationError",
  { reason: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return this.reason;
  }
}

export class NotTranscodedError extends Schema.TaggedErrorClass<NotTranscodedError>()(
  "NotTranscodedError",
  { videoId: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return `Video must be transcoded before publishing: ${this.videoId}`;
  }
}

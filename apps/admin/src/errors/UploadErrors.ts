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
  { assetId: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return `Asset must be transcoded before publishing: ${this.assetId}`;
  }
}

import { Schema } from "effect";

export class NoAssetTrackError extends Schema.TaggedErrorClass<NoAssetTrackError>()(
  "NoAssetTrackError",
  { filename: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return `Uploaded file has no supported audio or video track: ${this.filename}`;
  }
}

export class PosterDecodeError extends Schema.TaggedErrorClass<PosterDecodeError>()(
  "PosterDecodeError",
  { filename: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Could not decode poster frame: ${this.filename}`;
  }
}

export class InvalidConversionError extends Schema.TaggedErrorClass<InvalidConversionError>()(
  "InvalidConversionError",
  { assetId: Schema.String, reason: Schema.String },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Mediabunny conversion is invalid for ${this.assetId}: ${this.reason}`;
  }
}

export class TranscodeError extends Schema.TaggedErrorClass<TranscodeError>()(
  "TranscodeError",
  { assetId: Schema.String, operation: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Transcode failed for ${this.assetId} during ${this.operation}`;
  }
}

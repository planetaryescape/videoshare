import { Schema } from "effect";

export class NoVideoTrackError extends Schema.TaggedErrorClass<NoVideoTrackError>()(
  "NoVideoTrackError",
  { filename: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return `Uploaded file has no video track: ${this.filename}`;
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
  { videoId: Schema.String, reason: Schema.String },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Mediabunny conversion is invalid for ${this.videoId}: ${this.reason}`;
  }
}

export class TranscodeError extends Schema.TaggedErrorClass<TranscodeError>()(
  "TranscodeError",
  { videoId: Schema.String, operation: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Transcode failed for ${this.videoId} during ${this.operation}`;
  }
}

import { Schema } from "effect";

export class UnsupportedMediaError extends Schema.TaggedErrorClass<UnsupportedMediaError>()(
  "UnsupportedMediaError",
  { filename: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return `Unsupported media file: ${this.filename}`;
  }
}

export class InvalidImageError extends Schema.TaggedErrorClass<InvalidImageError>()(
  "InvalidImageError",
  { filename: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return `Invalid image file: ${this.filename}`;
  }
}

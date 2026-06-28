import { Schema } from "effect";

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  "StorageError",
  { operation: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Storage error during ${this.operation}`;
  }
}

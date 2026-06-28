import { Context, Effect, FileSystem, Layer, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { StorageError } from "../errors/StorageErrors.ts";

const liftPlatformError =
  (operation: string) =>
  <A, R>(effect: Effect.Effect<A, PlatformError, R>): Effect.Effect<A, StorageError, R> =>
    Effect.mapError(effect, (cause) => new StorageError({ operation, cause }));

export interface StorageService {
  readonly rootDir: string;
  readonly videoDir: (videoId: string) => string;
  readonly mediaPath: (relative: string) => string;
  readonly ensureVideoDir: (videoId: string) => Effect.Effect<void, StorageError, never>;
  readonly resetVideoDir: (videoId: string) => Effect.Effect<void, StorageError, never>;
  readonly removeVideoDir: (videoId: string) => Effect.Effect<void, StorageError, never>;
  readonly exists: (relative: string) => Effect.Effect<boolean, StorageError, never>;
  readonly readFile: (relative: string) => Effect.Effect<Uint8Array, StorageError, never>;
  readonly writeFile: (
    relative: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, StorageError, never>;
  readonly serveFile: (
    relative: string,
  ) => Effect.Effect<
    { readonly body: Uint8Array; readonly contentType: string },
    StorageError,
    never
  >;
}

const inferContentType = (key: string): string => {
  if (key.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (key.endsWith(".ts")) return "video/mp2t";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
};

export class Storage extends Context.Service<Storage, StorageService>()("admin/Storage") {
  static readonly layer: Layer.Layer<Storage, never, FileSystem.FileSystem | Path.Path> =
    Layer.effect(
      Storage,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.resolve("./videoshare-hls-output");

        yield* fs
          .makeDirectory(root, { recursive: true })
          .pipe(Effect.catchCause(() => Effect.void));

        const videoDir = (videoId: string) => path.join(root, videoId);
        const mediaPath = (relative: string) => path.join(root, relative);

        return Storage.of({
          rootDir: root,
          videoDir,
          mediaPath,
          ensureVideoDir: (videoId) =>
            fs
              .makeDirectory(videoDir(videoId), { recursive: true })
              .pipe(Effect.asVoid, liftPlatformError("ensureVideoDir")),
          resetVideoDir: (videoId) =>
            Effect.gen(function* () {
              const dir = videoDir(videoId);
              yield* fs
                .remove(dir, { recursive: true, force: true })
                .pipe(liftPlatformError("removeVideoDir"));
              yield* fs
                .makeDirectory(dir, { recursive: true })
                .pipe(Effect.asVoid, liftPlatformError("ensureVideoDir"));
            }),
          removeVideoDir: (videoId) =>
            fs
              .remove(videoDir(videoId), { recursive: true, force: true })
              .pipe(Effect.asVoid, liftPlatformError("removeVideoDir")),
          exists: (relative) => fs.exists(mediaPath(relative)).pipe(liftPlatformError("exists")),
          readFile: (relative) =>
            fs.readFile(mediaPath(relative)).pipe(liftPlatformError("readFile")),
          writeFile: (relative, bytes) =>
            fs
              .writeFile(mediaPath(relative), bytes)
              .pipe(Effect.asVoid, liftPlatformError("writeFile")),
          serveFile: (relative) =>
            Effect.gen(function* () {
              const body = yield* fs
                .readFile(mediaPath(relative))
                .pipe(liftPlatformError("readFile"));
              return { body, contentType: inferContentType(relative) };
            }),
        });
      }),
    );
}

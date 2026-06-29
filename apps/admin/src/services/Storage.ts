import { Context, Effect, FileSystem, Layer, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { StorageError } from "../errors/StorageErrors.ts";

const liftPlatformError =
  (operation: string) =>
  <A, R>(effect: Effect.Effect<A, PlatformError, R>): Effect.Effect<A, StorageError, R> =>
    Effect.mapError(effect, (cause) => new StorageError({ operation, cause }));

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

class PathTraversalError extends Error {
  readonly _tag = "PathTraversalError";
}

const isUnderRoot = (path: Path.Path, root: string, resolved: string): boolean =>
  resolved === root || resolved.startsWith(root + path.sep);

const resolveSafe = (path: Path.Path, root: string, relative: string): string => {
  const joined = path.join(root, relative);
  const resolved = path.resolve(joined);
  if (!isUnderRoot(path, root, resolved)) {
    throw new PathTraversalError(`Path escapes storage root: ${relative}`);
  }
  return resolved;
};

const validateVideoId = (videoId: string): void => {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new PathTraversalError(`Invalid videoId: ${videoId}`);
  }
};

export class Storage extends Context.Service<Storage, StorageService>()("admin/Storage") {
  static readonly layer: Layer.Layer<Storage, StorageError, FileSystem.FileSystem | Path.Path> =
    Layer.effect(
      Storage,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.resolve("./videoshare-hls-output");

        const toStorageError =
          (operation: string) =>
          (e: unknown): StorageError =>
            e instanceof PathTraversalError
              ? new StorageError({ operation, cause: e })
              : e instanceof Error
                ? new StorageError({ operation, cause: e })
                : new StorageError({ operation, cause: new Error(String(e)) });

        yield* fs
          .makeDirectory(root, { recursive: true })
          .pipe(
            Effect.catchTag("PlatformError", (e) =>
              e.reason._tag === "AlreadyExists"
                ? Effect.void
                : Effect.fail(new StorageError({ operation: "initRoot", cause: e })),
            ),
          );

        return Storage.of({
          rootDir: root,
          videoDir: (videoId) => {
            validateVideoId(videoId);
            return path.join(root, videoId);
          },
          mediaPath: (relative) => resolveSafe(path, root, relative),
          ensureVideoDir: (videoId) =>
            Effect.try({
              try: () => validateVideoId(videoId),
              catch: toStorageError("ensureVideoDir"),
            }).pipe(
              Effect.flatMap(() =>
                fs
                  .makeDirectory(path.join(root, videoId), { recursive: true })
                  .pipe(Effect.asVoid, liftPlatformError("ensureVideoDir")),
              ),
            ),
          resetVideoDir: (videoId) =>
            Effect.gen(function* () {
              yield* Effect.try({
                try: () => validateVideoId(videoId),
                catch: toStorageError("resetVideoDir"),
              });
              const dir = path.join(root, videoId);
              yield* fs
                .remove(dir, { recursive: true, force: true })
                .pipe(liftPlatformError("removeVideoDir"));
              yield* fs
                .makeDirectory(dir, { recursive: true })
                .pipe(Effect.asVoid, liftPlatformError("ensureVideoDir"));
            }),
          removeVideoDir: (videoId) =>
            Effect.gen(function* () {
              yield* Effect.try({
                try: () => validateVideoId(videoId),
                catch: toStorageError("removeVideoDir"),
              });
              yield* fs
                .remove(path.join(root, videoId), { recursive: true, force: true })
                .pipe(Effect.asVoid, liftPlatformError("removeVideoDir"));
            }),
          exists: (relative) =>
            Effect.try({
              try: () => resolveSafe(path, root, relative),
              catch: toStorageError("exists"),
            }).pipe(Effect.flatMap((p) => fs.exists(p).pipe(liftPlatformError("exists")))),
          readFile: (relative) =>
            Effect.try({
              try: () => resolveSafe(path, root, relative),
              catch: toStorageError("readFile"),
            }).pipe(Effect.flatMap((p) => fs.readFile(p).pipe(liftPlatformError("readFile")))),
          writeFile: (relative, bytes) =>
            Effect.try({
              try: () => resolveSafe(path, root, relative),
              catch: toStorageError("writeFile"),
            }).pipe(
              Effect.flatMap((p) =>
                fs.writeFile(p, bytes).pipe(Effect.asVoid, liftPlatformError("writeFile")),
              ),
            ),
          serveFile: (relative) =>
            Effect.gen(function* () {
              const p = yield* Effect.try({
                try: () => resolveSafe(path, root, relative),
                catch: toStorageError("serveFile"),
              });
              const body = yield* fs.readFile(p).pipe(liftPlatformError("readFile"));
              return { body, contentType: inferContentType(relative) };
            }),
        });
      }),
    );
}

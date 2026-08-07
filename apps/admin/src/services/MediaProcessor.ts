import { Context, Effect, Layer } from "effect";
import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  FilePathTarget,
  HlsOutputFormat,
  Input,
  MpegTsOutputFormat,
  Output,
  PathedTarget,
  QUALITY_HIGH,
  VideoSampleSink,
} from "mediabunny";
import type { ConversionAudioOptions, VideoSample } from "mediabunny";
import type { Kind } from "@videoshare/shared/Asset";
import { InvalidImageError, InvalidMarkdownError, UnsupportedMediaError } from "../errors/MediaErrors.ts";
import {
  InvalidConversionError,
  NoAssetTrackError,
  PosterDecodeError,
  TranscodeError,
} from "../errors/TranscodeErrors.ts";
import type { StorageError } from "../errors/StorageErrors.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { Storage } from "./Storage.ts";
import * as Telemetry from "./Telemetry.ts";

const abrRungs: ReadonlyArray<number> = [1080, 720, 480];
const maxImageBytes = 50 * 1024 * 1024;
const maxMarkdownBytes = 1024 * 1024;
const markdownExtensionPattern = /\.(md|markdown)$/i;

const selectAbrHeights = (sourceHeight: number): ReadonlyArray<number> => {
  const selected = abrRungs.filter((h) => h <= sourceHeight);
  if (selected.length > 0) return selected;
  const rounded = Math.max(2, Math.round(sourceHeight / 2) * 2);
  return [rounded];
};

const toBmpBytes = (sample: VideoSample): Effect.Effect<Uint8Array, PosterDecodeError> =>
  Effect.gen(function* () {
    const width = sample.displayWidth;
    const height = sample.displayHeight;
    const rgba = new Uint8Array(
      yield* Effect.sync(() => sample.allocationSize({ format: "RGBA" })),
    );
    yield* Effect.tryPromise({
      try: () => sample.copyTo(rgba, { format: "RGBA" }),
      catch: (cause) => new PosterDecodeError({ filename: "sample", cause }),
    });

    const rowBytes = width * 3;
    const paddedRowBytes = Math.ceil(rowBytes / 4) * 4;
    const pixelBytes = paddedRowBytes * height;
    const fileSize = 54 + pixelBytes;
    const buffer = new ArrayBuffer(fileSize);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    view.setUint32(2, fileSize, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, pixelBytes, true);

    for (let y = 0; y < height; y += 1) {
      const srcRow = y * width * 4;
      const dstRow = 54 + (height - y - 1) * paddedRowBytes;
      for (let x = 0; x < width; x += 1) {
        const src = srcRow + x * 4;
        const dst = dstRow + x * 3;
        bytes[dst] = rgba[src + 2] ?? 0;
        bytes[dst + 1] = rgba[src + 1] ?? 0;
        bytes[dst + 2] = rgba[src] ?? 0;
      }
    }

    return bytes;
  });

const writePoster = (
  assetId: string,
  file: File,
): Effect.Effect<
  void,
  NoAssetTrackError | PosterDecodeError | TranscodeError | StorageError,
  Storage
> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    let sample: Awaited<ReturnType<VideoSampleSink["getSample"]>> | null = null;
    let frame: Awaited<ReturnType<VideoSample["transform"]>> | null = null;

    const work = Effect.gen(function* () {
      const videoTrack = yield* Effect.tryPromise({
        try: () => input.getPrimaryVideoTrack(),
        catch: (cause) => new TranscodeError({ assetId, operation: "getPrimaryVideoTrack", cause }),
      });
      if (!videoTrack) {
        return yield* new NoAssetTrackError({ filename: file.name });
      }

      const sink = new VideoSampleSink(videoTrack);
      const start = yield* Effect.tryPromise({
        try: () => videoTrack.getFirstTimestamp(),
        catch: (cause) => new TranscodeError({ assetId, operation: "getFirstTimestamp", cause }),
      });
      const duration = yield* Effect.tryPromise({
        try: () => videoTrack.computeDuration(),
        catch: (cause) => new TranscodeError({ assetId, operation: "computeDuration", cause }),
      });
      const preferred = duration > start ? Math.min(start + 1, duration) : start;
      const fetched =
        (yield* Effect.tryPromise({
          try: () => sink.getSample(preferred),
          catch: (cause) => new TranscodeError({ assetId, operation: "getSample", cause }),
        })) ??
        (yield* Effect.tryPromise({
          try: () => sink.getSample(start),
          catch: (cause) => new TranscodeError({ assetId, operation: "getSample", cause }),
        }));
      if (!fetched) {
        return yield* new PosterDecodeError({
          filename: file.name,
          cause: new Error("no sample"),
        });
      }
      sample = fetched;

      const currentSample: Awaited<ReturnType<VideoSampleSink["getSample"]>> = sample;
      const transformed = yield* Effect.tryPromise({
        try: () =>
          currentSample.transform({
            width: Math.min(1280, currentSample.displayWidth),
            roundDimensionsTo: 2,
            alpha: "discard",
          }),
        catch: (cause) => new TranscodeError({ assetId, operation: "transformFrame", cause }),
      });
      frame = transformed;
      const currentFrame: Awaited<ReturnType<VideoSample["transform"]>> = frame;

      const bmp = yield* toBmpBytes(currentFrame);
      const jpeg = yield* Effect.tryPromise({
        try: () => new Bun.Image(bmp).jpeg({ quality: 85, progressive: true }).bytes(),
        catch: (cause) => new TranscodeError({ assetId, operation: "encodeJpeg", cause }),
      });
      yield* storage.writeFile(`${assetId}/poster.jpg`, jpeg);
    });

    return yield* work.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          frame?.close();
          sample?.close();
          input.dispose();
        }),
      ),
    );
  });

/** Decodes an uploaded cover before media processing mutates the asset directory. */
const prepareCoverImage = (file: File): Effect.Effect<Uint8Array, PosterDecodeError> =>
  Effect.tryPromise({
    try: () =>
      new Bun.Image(file)
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .bytes(),
    catch: (cause) => new PosterDecodeError({ filename: file.name, cause }),
  });

type ImageFilename = "original.jpg" | "original.png" | "original.webp";

export type ProcessedMedia =
  | {
      readonly kind: "image";
      readonly durationSec: 0;
      readonly filename: ImageFilename;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: "markdown";
      readonly durationSec: 0;
      readonly filename: "content.md";
      readonly width: null;
      readonly height: null;
    }
  | {
      readonly kind: "video" | "audio";
      readonly durationSec: number;
      readonly filename: "master.m3u8";
      readonly width: null;
      readonly height: null;
    };

const imageFormat = (bytes: Uint8Array): "jpg" | "png" | "webp" | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  if (
    bytes.length >= 8 &&
    bytes
      .slice(0, 8)
      .every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
  )
    return "png";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
};

const imageFilename = (format: "jpg" | "png" | "webp"): ImageFilename => {
  switch (format) {
    case "jpg":
      return "original.jpg";
    case "png":
      return "original.png";
    case "webp":
      return "original.webp";
  }
};

const rejectedImageFormat = (bytes: Uint8Array): string | null => {
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a") return "GIF";
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a") return "GIF";
  const text = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  return text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))
    ? "SVG"
    : null;
};

export interface MediaProcessorService {
  /** Detects supported content and stores it locally; remote publication is owned by Publisher. */
  readonly process: (
    assetId: string,
    file: File,
  ) => Effect.Effect<
    ProcessedMedia,
    | UnsupportedMediaError
    | InvalidImageError
    | InvalidMarkdownError
    | NoAssetTrackError
    | PosterDecodeError
    | TranscodeError
    | InvalidConversionError
    | StorageError
  >;
  /** Decodes and normalizes a cover before media processing begins. */
  readonly prepareCoverImage: (file: File) => Effect.Effect<Uint8Array, PosterDecodeError>;
  /** Writes a previously prepared cover beside processed media. */
  readonly writeCoverImage: (
    assetId: string,
    jpeg: Uint8Array,
  ) => Effect.Effect<void, StorageError>;
}

export class MediaProcessor extends Context.Service<MediaProcessor, MediaProcessorService>()(
  "admin/MediaProcessor",
) {
  static readonly layer: Layer.Layer<MediaProcessor, never, ProgressBus | Storage> = Layer.effect(
    MediaProcessor,
    Effect.gen(function* () {
      const progress = yield* ProgressBus;
      const storage = yield* Storage;
      const publishContext = yield* Effect.context<ProgressBus>();

      const process = (assetId: string, file: File) =>
        Effect.gen(function* () {
          const header = new Uint8Array(
            yield* Effect.tryPromise({
              try: () => file.slice(0, 512).arrayBuffer(),
              catch: () => new UnsupportedMediaError({ filename: file.name }),
            }),
          );
          if (rejectedImageFormat(header)) {
            return yield* new UnsupportedMediaError({ filename: file.name });
          }
          const format = imageFormat(header);
          if (format) {
            if (file.size > maxImageBytes)
              return yield* new InvalidImageError({ filename: file.name });
            const bytes = new Uint8Array(
              yield* Effect.tryPromise({
                try: () => file.arrayBuffer(),
                catch: () => new InvalidImageError({ filename: file.name }),
              }),
            );
            const dimensions = yield* Effect.tryPromise({
              try: async () => {
                const metadata = await new Bun.Image(bytes).metadata();
                if (
                  !Number.isInteger(metadata.width) ||
                  !Number.isInteger(metadata.height) ||
                  metadata.width < 1 ||
                  metadata.height < 1
                ) {
                  throw new Error("image has invalid dimensions");
                }
                return { width: metadata.width, height: metadata.height };
              },
              catch: () => new InvalidImageError({ filename: file.name }),
            });
            yield* storage.resetAssetDir(assetId);
            const filename = imageFilename(format);
            yield* storage.writeFile(`${assetId}/${filename}`, bytes);
            yield* progress.publish({ assetId, stage: "done", pct: 100 });
            const image: ProcessedMedia = {
              kind: "image",
              durationSec: 0,
              filename,
              ...dimensions,
            };
            return image;
          }

          if (markdownExtensionPattern.test(file.name)) {
            if (file.size > maxMarkdownBytes)
              return yield* new InvalidMarkdownError({ filename: file.name });
            const bytes = new Uint8Array(
              yield* Effect.tryPromise({
                try: () => file.arrayBuffer(),
                catch: () => new InvalidMarkdownError({ filename: file.name }),
              }),
            );
            const source = yield* Effect.try({
              try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              catch: () => new InvalidMarkdownError({ filename: file.name }),
            });
            yield* storage.resetAssetDir(assetId);
            yield* storage.writeFile(
              `${assetId}/content.md`,
              new TextEncoder().encode(source),
            );
            yield* progress.publish({ assetId, stage: "done", pct: 100 });
            const markdown: ProcessedMedia = {
              kind: "markdown",
              durationSec: 0,
              filename: "content.md",
              width: null,
              height: null,
            };
            return markdown;
          }

          yield* storage.resetAssetDir(assetId);
          const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
          let conversion: Conversion | null = null;

          const work = Effect.gen(function* () {
            const duration = yield* Effect.tryPromise({
              try: () => input.computeDuration(),
              catch: (cause) =>
                new TranscodeError({ assetId, operation: "computeDuration", cause }),
            });

            const videoTrack = yield* Effect.tryPromise({
              try: () => input.getPrimaryVideoTrack(),
              catch: (cause) =>
                new TranscodeError({ assetId, operation: "getPrimaryVideoTrack", cause }),
            });
            const kind: Kind = videoTrack ? "video" : "audio";

            const output = new Output({
              format: new HlsOutputFormat({
                segmentFormat: new MpegTsOutputFormat(),
                targetDuration: 6,
              }),
              target: new PathedTarget(
                "master.m3u8",
                ({ path }) => new FilePathTarget(`${storage.assetDir(assetId)}/${path}`),
              ),
            });

            const audioConfig: ConversionAudioOptions = {
              codec: "aac",
              bitrate: 128_000,
              numberOfChannels: 2,
              sampleRate: 48_000,
            };

            const built = yield* Effect.tryPromise({
              try: () =>
                kind === "video"
                  ? Conversion.init({
                      input,
                      output,
                      tracks: "primary",
                      video: async (track) => {
                        const sourceWidth = await track.getDisplayWidth();
                        const sourceHeight = await track.getDisplayHeight();
                        return selectAbrHeights(sourceHeight).map((height) => ({
                          codec: "avc",
                          width: Math.max(
                            2,
                            Math.round((sourceWidth * height) / sourceHeight / 2) * 2,
                          ),
                          height,
                          fit: "contain",
                          frameRate: 30,
                          bitrate: QUALITY_HIGH,
                          keyFrameInterval: 2,
                          alpha: "discard",
                        }));
                      },
                      audio: audioConfig,
                    })
                  : Conversion.init({
                      input,
                      output,
                      tracks: "primary",
                      audio: audioConfig,
                    }),
              catch: (cause) =>
                new TranscodeError({ assetId, operation: "Conversion.init", cause }),
            });
            conversion = built;

            if (!conversion.isValid) {
              const reasons = conversion.discardedTracks
                .map((discarded) => `${discarded.track.type}:${discarded.reason}`)
                .join(", ");
              return yield* new InvalidConversionError({
                assetId,
                reason: reasons.length > 0 ? reasons : "unknown",
              });
            }

            yield* progress.publish({ assetId, stage: "transcoding", pct: 0 });
            conversion.onProgress = (p) => {
              Effect.runForkWith(publishContext)(
                progress.publish({
                  assetId,
                  stage: "transcoding",
                  pct: Math.min(98, Math.round(p * 98)),
                }),
              );
            };
            const currentConversion: Conversion = conversion;
            yield* Effect.tryPromise({
              try: () => currentConversion.execute(),
              catch: (cause) => new TranscodeError({ assetId, operation: "execute", cause }),
            });

            if (kind === "video") {
              yield* progress.publish({ assetId, stage: "poster", pct: 99 });
              yield* writePoster(assetId, file);
            }

            yield* progress.publish({ assetId, stage: "done", pct: 100 });
            const timed: ProcessedMedia = {
              durationSec: Number.isFinite(duration) ? duration : 0,
              kind,
              filename: "master.m3u8",
              width: null,
              height: null,
            };
            return timed;
          });

          return yield* work.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                conversion = null;
                input.dispose();
              }),
            ),
          );
        });

      return MediaProcessor.of({
        process: (assetId, file) =>
          Telemetry.trace(
            "admin.media.process",
            { "media.input_bytes": file.size },
            process(assetId, file).pipe(Effect.provideService(Storage, storage)),
            { successAttributes: (media) => ({ "media.kind": media.kind }) },
          ),
        prepareCoverImage,
        writeCoverImage: (assetId, jpeg) => storage.writeFile(`${assetId}/poster.jpg`, jpeg),
      });
    }),
  );
}

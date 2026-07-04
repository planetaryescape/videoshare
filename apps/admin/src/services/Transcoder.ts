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
import type { Kind } from "@videoshare/shared/Video";
import {
  InvalidConversionError,
  NoVideoTrackError,
  PosterDecodeError,
  TranscodeError,
} from "../errors/TranscodeErrors.ts";
import type { StorageError } from "../errors/StorageErrors.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { Storage } from "./Storage.ts";

const abrRungs: ReadonlyArray<number> = [1080, 720, 480];

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
  videoId: string,
  file: File,
): Effect.Effect<
  void,
  NoVideoTrackError | PosterDecodeError | TranscodeError | StorageError,
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
        catch: (cause) => new TranscodeError({ videoId, operation: "getPrimaryVideoTrack", cause }),
      });
      if (!videoTrack) {
        return yield* new NoVideoTrackError({ filename: file.name });
      }

      const sink = new VideoSampleSink(videoTrack);
      const start = yield* Effect.tryPromise({
        try: () => videoTrack.getFirstTimestamp(),
        catch: (cause) => new TranscodeError({ videoId, operation: "getFirstTimestamp", cause }),
      });
      const duration = yield* Effect.tryPromise({
        try: () => videoTrack.computeDuration(),
        catch: (cause) => new TranscodeError({ videoId, operation: "computeDuration", cause }),
      });
      const preferred = duration > start ? Math.min(start + 1, duration) : start;
      const fetched =
        (yield* Effect.tryPromise({
          try: () => sink.getSample(preferred),
          catch: (cause) => new TranscodeError({ videoId, operation: "getSample", cause }),
        })) ??
        (yield* Effect.tryPromise({
          try: () => sink.getSample(start),
          catch: (cause) => new TranscodeError({ videoId, operation: "getSample", cause }),
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
        catch: (cause) => new TranscodeError({ videoId, operation: "transformFrame", cause }),
      });
      frame = transformed;
      const currentFrame: Awaited<ReturnType<VideoSample["transform"]>> = frame;

      const bmp = yield* toBmpBytes(currentFrame);
      const jpeg = yield* Effect.tryPromise({
        try: () => new Bun.Image(bmp).jpeg({ quality: 85, progressive: true }).bytes(),
        catch: (cause) => new TranscodeError({ videoId, operation: "encodeJpeg", cause }),
      });
      yield* storage.writeFile(`${videoId}/poster.jpg`, jpeg);
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

const writePosterImage = (
  videoId: string,
  file: File,
): Effect.Effect<void, PosterDecodeError | StorageError, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    const jpeg = yield* Effect.tryPromise({
      try: () =>
        new Bun.Image(file)
          .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .bytes(),
      catch: (cause) => new PosterDecodeError({ filename: file.name, cause }),
    });
    yield* storage.writeFile(`${videoId}/poster.jpg`, jpeg);
  });

export interface TranscodeResult {
  readonly durationSec: number;
  readonly kind: Kind;
}

export interface TranscoderService {
  readonly transcode: (
    videoId: string,
    file: File,
  ) => Effect.Effect<
    TranscodeResult,
    NoVideoTrackError | PosterDecodeError | TranscodeError | InvalidConversionError | StorageError,
    Storage
  >;
  readonly writePoster: (
    videoId: string,
    file: File,
  ) => Effect.Effect<void, PosterDecodeError | StorageError, Storage>;
}

export class Transcoder extends Context.Service<Transcoder, TranscoderService>()(
  "admin/Transcoder",
) {
  static readonly layer: Layer.Layer<Transcoder, never, ProgressBus | Storage> = Layer.effect(
    Transcoder,
    Effect.gen(function* () {
      const progress = yield* ProgressBus;
      const storage = yield* Storage;
      const publishContext = yield* Effect.context<ProgressBus>();

      const transcode = (
        videoId: string,
        file: File,
      ): Effect.Effect<
        TranscodeResult,
        | NoVideoTrackError
        | PosterDecodeError
        | TranscodeError
        | InvalidConversionError
        | StorageError,
        Storage
      > =>
        Effect.gen(function* () {
          yield* storage.resetVideoDir(videoId);

          const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
          let conversion: Conversion | null = null;

          const work = Effect.gen(function* () {
            const duration = yield* Effect.tryPromise({
              try: () => input.computeDuration(),
              catch: (cause) =>
                new TranscodeError({ videoId, operation: "computeDuration", cause }),
            });

            const videoTrack = yield* Effect.tryPromise({
              try: () => input.getPrimaryVideoTrack(),
              catch: (cause) =>
                new TranscodeError({ videoId, operation: "getPrimaryVideoTrack", cause }),
            });
            const kind: Kind = videoTrack ? "video" : "audio";

            const output = new Output({
              format: new HlsOutputFormat({
                segmentFormat: new MpegTsOutputFormat(),
                targetDuration: 6,
              }),
              target: new PathedTarget(
                "master.m3u8",
                ({ path }) => new FilePathTarget(`${storage.videoDir(videoId)}/${path}`),
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
                new TranscodeError({ videoId, operation: "Conversion.init", cause }),
            });
            conversion = built;

            if (!conversion.isValid) {
              const reasons = conversion.discardedTracks
                .map((discarded) => `${discarded.track.type}:${discarded.reason}`)
                .join(", ");
              return yield* new InvalidConversionError({
                videoId,
                reason: reasons.length > 0 ? reasons : "unknown",
              });
            }

            yield* progress.publish({ videoId, stage: "transcoding", pct: 0 });
            conversion.onProgress = (p) => {
              Effect.runForkWith(publishContext)(
                progress.publish({
                  videoId,
                  stage: "transcoding",
                  pct: Math.min(98, Math.round(p * 98)),
                }),
              );
            };
            const currentConversion: Conversion = conversion;
            yield* Effect.tryPromise({
              try: () => currentConversion.execute(),
              catch: (cause) => new TranscodeError({ videoId, operation: "execute", cause }),
            });

            if (kind === "video") {
              yield* progress.publish({ videoId, stage: "poster", pct: 99 });
              yield* writePoster(videoId, file);
            }

            yield* progress.publish({ videoId, stage: "done", pct: 100 });
            return { durationSec: Number.isFinite(duration) ? duration : 0, kind };
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

      return Transcoder.of({ transcode, writePoster: writePosterImage });
    }),
  );
}

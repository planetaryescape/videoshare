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
import type { ConversionVideoOptions, VideoSample } from "mediabunny";
import {
  InvalidConversionError,
  NoVideoTrackError,
  PosterDecodeError,
  TranscodeError,
} from "../errors/TranscodeErrors.ts";
import type { StorageError } from "../errors/StorageErrors.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { Storage } from "./Storage.ts";

const abrRungs = [1080, 720, 480] as const;
const fallbackAbrHeight = 480;

const selectAbrHeights = (sourceHeight: number): ReadonlyArray<number> => {
  const selected = abrRungs.filter((h) => h <= sourceHeight);
  return selected.length > 0 ? selected : [fallbackAbrHeight];
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
  file: File,
  outputPath: string,
): Effect.Effect<
  void,
  NoVideoTrackError | PosterDecodeError | TranscodeError | StorageError,
  Storage
> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

    const work = Effect.gen(function* () {
      const videoTrack = yield* Effect.tryPromise({
        try: () => input.getPrimaryVideoTrack(),
        catch: (cause) =>
          new TranscodeError({ videoId: "unknown", operation: "getPrimaryVideoTrack", cause }),
      });
      if (!videoTrack) {
        return yield* new NoVideoTrackError({ filename: file.name });
      }

      const sink = new VideoSampleSink(videoTrack);
      const start = yield* Effect.tryPromise({
        try: () => videoTrack.getFirstTimestamp(),
        catch: (cause) =>
          new TranscodeError({ videoId: "unknown", operation: "getFirstTimestamp", cause }),
      });
      const duration = yield* Effect.tryPromise({
        try: () => videoTrack.computeDuration(),
        catch: (cause) =>
          new TranscodeError({ videoId: "unknown", operation: "computeDuration", cause }),
      });
      const preferred = duration > start ? Math.min(start + 1, duration) : start;
      const sample =
        (yield* Effect.tryPromise({
          try: () => sink.getSample(preferred),
          catch: (cause) =>
            new TranscodeError({ videoId: "unknown", operation: "getSample", cause }),
        })) ??
        (yield* Effect.tryPromise({
          try: () => sink.getSample(start),
          catch: (cause) =>
            new TranscodeError({ videoId: "unknown", operation: "getSample", cause }),
        }));
      if (!sample) {
        return yield* new PosterDecodeError({ filename: file.name, cause: new Error("no sample") });
      }

      const frame = yield* Effect.tryPromise({
        try: () =>
          sample.transform({
            width: Math.min(1280, sample.displayWidth),
            roundDimensionsTo: 2,
            alpha: "discard",
          }),
        catch: (cause) =>
          new TranscodeError({ videoId: "unknown", operation: "transformFrame", cause }),
      });

      try {
        const bmp = yield* toBmpBytes(frame);
        const jpeg = yield* Effect.tryPromise({
          try: () => new Bun.Image(bmp).jpeg({ quality: 85, progressive: true }).bytes(),
          catch: (cause) =>
            new TranscodeError({ videoId: "unknown", operation: "encodeJpeg", cause }),
        });
        yield* storage.writeFile(outputPath, jpeg);
      } finally {
        frame.close();
        sample.close();
      }
    });

    return yield* work.pipe(Effect.ensuring(Effect.sync(() => input.dispose())));
  });

const abrVariant = (
  sourceWidth: number,
  sourceHeight: number,
  height: number,
): ConversionVideoOptions => ({
  codec: "avc",
  width: Math.max(2, Math.round((sourceWidth * height) / sourceHeight / 2) * 2),
  height,
  fit: "contain",
  frameRate: 30,
  bitrate: QUALITY_HIGH,
  keyFrameInterval: 2,
  alpha: "discard",
});

export interface TranscoderService {
  readonly transcode: (
    videoId: string,
    file: File,
  ) => Effect.Effect<
    number,
    NoVideoTrackError | PosterDecodeError | TranscodeError | InvalidConversionError | StorageError,
    Storage
  >;
}

export class Transcoder extends Context.Service<Transcoder, TranscoderService>()(
  "admin/Transcoder",
) {
  static readonly layer: Layer.Layer<Transcoder, never, ProgressBus | Storage> = Layer.effect(
    Transcoder,
    Effect.gen(function* () {
      const progress = yield* ProgressBus;
      const storage = yield* Storage;

      const transcode = (
        videoId: string,
        file: File,
      ): Effect.Effect<
        number,
        | NoVideoTrackError
        | PosterDecodeError
        | TranscodeError
        | InvalidConversionError
        | StorageError,
        Storage
      > =>
        Effect.gen(function* () {
          yield* storage.resetVideoDir(videoId);
          const outputDir = storage.videoDir(videoId);

          const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

          const work = Effect.gen(function* () {
            const duration = yield* Effect.tryPromise({
              try: () => input.computeDuration(),
              catch: (cause) =>
                new TranscodeError({ videoId, operation: "computeDuration", cause }),
            });

            const output = new Output({
              format: new HlsOutputFormat({
                segmentFormat: new MpegTsOutputFormat(),
                targetDuration: 6,
              }),
              target: new PathedTarget(
                "master.m3u8",
                ({ path }) => new FilePathTarget(`${outputDir}/${path}`),
              ),
            });

            const conversion = yield* Effect.tryPromise({
              try: () =>
                Conversion.init({
                  input,
                  output,
                  tracks: "primary",
                  video: async (track) => {
                    const sourceWidth = await track.getDisplayWidth();
                    const sourceHeight = await track.getDisplayHeight();
                    return selectAbrHeights(sourceHeight).map((height) =>
                      abrVariant(sourceWidth, sourceHeight, height),
                    );
                  },
                  audio: {
                    codec: "aac",
                    bitrate: 128_000,
                    numberOfChannels: 2,
                    sampleRate: 48_000,
                  },
                }),
              catch: (cause) =>
                new TranscodeError({ videoId, operation: "Conversion.init", cause }),
            });

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
              progress.publish({
                videoId,
                stage: "transcoding",
                pct: Math.min(98, Math.round(p * 98)),
              });
            };
            yield* Effect.tryPromise({
              try: () => conversion.execute(),
              catch: (cause) => new TranscodeError({ videoId, operation: "execute", cause }),
            });

            yield* progress.publish({ videoId, stage: "poster", pct: 99 });
            yield* writePoster(file, `${outputDir}/poster.jpg`);

            yield* progress.publish({ videoId, stage: "done", pct: 100 });
            return Number.isFinite(duration) ? duration : 0;
          });

          return yield* work.pipe(Effect.ensuring(Effect.sync(() => input.dispose())));
        });

      return Transcoder.of({ transcode });
    }),
  );
}

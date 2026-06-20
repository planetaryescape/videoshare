import { SqliteClient } from "@effect/sql-sqlite-bun";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { Chapter, ChapterId, Video, VideoId } from "@videoshare/shared/Video";
import { generateSlug } from "@videoshare/shared/Slug";
import { migrate } from "@videoshare/shared/Migrations";
import { errorStatus, VideoNotFoundError } from "@videoshare/shared/VideoErrors";
import type {
  PersistenceError,
  ProdSyncError,
  SlugAlreadyExistsError,
} from "@videoshare/shared/VideoErrors";
import { Cause, Effect, Option } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { registerMediabunnyServer } from "@mediabunny/server";
import type { ConversionVideoOptions, VideoSample } from "mediabunny";
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
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { BunRequest, ServerWebSocket } from "bun";
import { mediaExists, syncMetadata, uploadMedia } from "./src/prod";

const dbFilename = "./videoshare-admin.db";
const hlsOutputDir = "./videoshare-hls-output";

if (!existsSync(hlsOutputDir)) await mkdir(hlsOutputDir, { recursive: true });

registerMediabunnyServer();

const sqlLayer = SqliteClient.layer({ filename: dbFilename });
await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const progressSockets = new Map<string, Set<ServerWebSocket<{ videoId: string }>>>();

const emitProgress = (videoId: string, payload: { stage: string; pct: number }) => {
  const sockets = progressSockets.get(videoId);
  if (!sockets) return;
  const frame = JSON.stringify({ videoId, ...payload });
  for (const ws of sockets) ws.send(frame);
};

const abrRungs = [1080, 720, 480] as const;
const fallbackAbrHeight = 480;

const selectAbrHeights = (sourceHeight: number): ReadonlyArray<number> => {
  const selected = abrRungs.filter((height) => height <= sourceHeight);
  return selected.length > 0 ? selected : [fallbackAbrHeight];
};

const toBmp = async (sample: VideoSample) => {
  const width = sample.displayWidth;
  const height = sample.displayHeight;
  const rgba = new Uint8Array(sample.allocationSize({ format: "RGBA" }));
  await sample.copyTo(rgba, { format: "RGBA" });

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
};

const writePoster = async (file: File, outputPath: string): Promise<void> => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("Uploaded file has no video track");
    }

    const sink = new VideoSampleSink(videoTrack);
    const start = await videoTrack.getFirstTimestamp();
    const duration = await videoTrack.computeDuration();
    const preferred = duration > start ? Math.min(start + 1, duration) : start;
    const sample = (await sink.getSample(preferred)) ?? (await sink.getSample(start));
    if (!sample) {
      throw new Error("Could not decode poster frame");
    }

    const frame = await sample.transform({
      width: Math.min(1280, sample.displayWidth),
      roundDimensionsTo: 2,
      alpha: "discard",
    });

    try {
      const bmp = await toBmp(frame);
      const jpeg = await new Bun.Image(bmp).jpeg({ quality: 85, progressive: true }).bytes();
      await Bun.write(outputPath, jpeg);
    } finally {
      frame.close();
      sample.close();
    }
  } finally {
    input.dispose();
  }
};

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

const transcode = async (videoId: string, file: File): Promise<number> => {
  const outputDir = `${hlsOutputDir}/${videoId}`;
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });

  try {
    const duration = await input.computeDuration();
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

    const conversion = await Conversion.init({
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
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map((discarded) => `${discarded.track.type}:${discarded.reason}`)
        .join(", ");
      throw new Error(
        reasons.length > 0
          ? `Mediabunny conversion is invalid: ${reasons}`
          : "Mediabunny conversion is invalid",
      );
    }

    emitProgress(videoId, { stage: "transcoding", pct: 0 });
    conversion.onProgress = (progress) => {
      emitProgress(videoId, { stage: "transcoding", pct: Math.min(98, Math.round(progress * 98)) });
    };
    await conversion.execute();

    emitProgress(videoId, { stage: "poster", pct: 99 });
    await writePoster(file, `${outputDir}/poster.jpg`);

    emitProgress(videoId, { stage: "done", pct: 100 });
    return Number.isFinite(duration) ? duration : 0;
  } finally {
    input.dispose();
  }
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });

type RouteError = PersistenceError | SlugAlreadyExistsError | VideoNotFoundError | ProdSyncError;

const failureResponse = (tag: keyof typeof errorStatus, message: string) =>
  Effect.succeed(json({ error: message }, errorStatus[tag] ?? 500));

const runRoute = (
  effect: Effect.Effect<Response, RouteError, VideoRepository | SqlClient.SqlClient>,
) =>
  effect.pipe(
    Effect.catchTags({
      PersistenceError: (e) => failureResponse("PersistenceError", e.message),
      SlugAlreadyExistsError: (e) => failureResponse("SlugAlreadyExistsError", e.message),
      VideoNotFoundError: (e) => failureResponse("VideoNotFoundError", e.message),
      ProdSyncError: (e) => failureResponse("ProdSyncError", e.message),
    }),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        process.stderr.write(`${Cause.pretty(cause)}\n`);
        return json({ error: "Internal Server Error" }, 500);
      }),
    ),
    Effect.provide(VideoRepository.layerNoDeps),
    Effect.provide(sqlLayer),
    Effect.runPromise,
  );

Bun.serve<{ videoId: string }>({
  port: 3001,
  maxRequestBodySize: 1024 * 1024 * 1024 * 5,
  routes: {
    "/api/videos": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      GET: () =>
        runRoute(
          Effect.gen(function* () {
            const repo = yield* VideoRepository;
            return json(yield* repo.list());
          }),
        ),
      POST: (req: BunRequest<"/api/videos">) =>
        runRoute(
          Effect.gen(function* () {
            const repo = yield* VideoRepository;
            const body = yield* Effect.promise(
              () => req.json() as Promise<{ title: string; description?: string }>,
            );
            const video = new Video({
              id: VideoId.make(crypto.randomUUID()),
              slug: generateSlug(),
              title: body.title,
              description: body.description ?? null,
              posterKey: null,
              hlsKey: "",
              durationSec: 0,
              passwordHash: null,
              createdAt: Date.now(),
              publishedAt: null,
              updatedAt: null,
            });
            return json(yield* repo.create(video), 201);
          }),
        ),
    },
    "/api/videos/:id": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      GET: (req: BunRequest<"/api/videos/:id">) =>
        runRoute(
          Effect.gen(function* () {
            const repo = yield* VideoRepository;
            const video = yield* repo.findById(VideoId.make(req.params.id));
            if (Option.isNone(video)) {
              return yield* new VideoNotFoundError({ slug: req.params.id });
            }
            const chapters = yield* repo.listChapters(video.value.id);
            return json({ video: video.value, chapters });
          }),
        ),
      PUT: (req: BunRequest<"/api/videos/:id">) =>
        runRoute(
          Effect.gen(function* () {
            const repo = yield* VideoRepository;
            const found = yield* repo.findById(VideoId.make(req.params.id));
            if (Option.isNone(found)) {
              return yield* new VideoNotFoundError({ slug: req.params.id });
            }
            const body = yield* Effect.promise(
              () =>
                req.json() as Promise<{
                  title?: string;
                  description?: string;
                  chapters?: Array<{ id?: string; title: string; startSec: number }>;
                }>,
            );
            const updated = new Video({
              ...found.value,
              title: body.title ?? found.value.title,
              description: body.description ?? found.value.description,
              updatedAt: Date.now(),
            });
            const video = yield* repo.update(updated);

            if (body.chapters !== undefined) {
              const chapters = body.chapters.map(
                (ch, index) =>
                  new Chapter({
                    id: ChapterId.make(ch.id ?? crypto.randomUUID()),
                    videoId: video.id,
                    title: ch.title,
                    startSec: ch.startSec,
                    sortOrder: index,
                  }),
              );
              yield* repo.replaceChapters(video.id, chapters);
            }

            const chapters = yield* repo.listChapters(video.id);
            return json({ video, chapters });
          }),
        ),
      DELETE: (req: BunRequest<"/api/videos/:id">) =>
        runRoute(
          Effect.gen(function* () {
            const id = req.params.id;
            const repo = yield* VideoRepository;
            yield* repo.delete(VideoId.make(id));
            const outputPath = `${hlsOutputDir}/${id}`;
            yield* Effect.promise(async () => {
              if (existsSync(outputPath)) {
                await rm(outputPath, { recursive: true, force: true });
              }
            });
            return json({ success: true });
          }),
        ),
    },
    "/api/upload": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      POST: (req: BunRequest<"/api/upload">) =>
        runRoute(
          Effect.gen(function* () {
            const repo = yield* VideoRepository;
            const formData = yield* Effect.promise<FormData>(() => req.formData());
            const videoIdField = formData.get("videoId");
            const file = formData.get("file");
            if (typeof videoIdField !== "string" || !(file instanceof File)) {
              return json({ error: "videoId and file are required" }, 400);
            }
            const videoId = videoIdField;

            const found = yield* repo.findById(VideoId.make(videoId));
            if (Option.isNone(found)) {
              return yield* new VideoNotFoundError({ slug: videoId });
            }

            const duration = yield* Effect.promise(() => transcode(videoId, file));

            emitProgress(videoId, { stage: "uploading-media", pct: 100 });
            yield* uploadMedia(videoId, `${hlsOutputDir}/${videoId}`);

            const updatedVideo = new Video({
              ...found.value,
              hlsKey: `media/${videoId}/master.m3u8`,
              posterKey: `media/${videoId}/poster.jpg`,
              durationSec: isNaN(duration) ? 0 : duration,
              updatedAt: Date.now(),
            });
            return json(yield* repo.update(updatedVideo));
          }),
        ),
    },
    "/api/publish/:id": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      POST: (req: BunRequest<"/api/publish/:id">) =>
        runRoute(
          Effect.gen(function* () {
            const repo = yield* VideoRepository;
            const found = yield* repo.findById(VideoId.make(req.params.id));
            if (Option.isNone(found)) {
              return yield* new VideoNotFoundError({ slug: req.params.id });
            }
            if (!found.value.hlsKey) {
              return json({ error: "Video must be transcoded before publishing" }, 400);
            }
            const publishedVideo = new Video({
              ...found.value,
              publishedAt: Date.now(),
            });
            const updated = yield* repo.update(publishedVideo);
            const chapters = yield* repo.listChapters(updated.id);

            const hasMedia = yield* mediaExists(updated.id);
            if (!hasMedia) {
              yield* uploadMedia(updated.id, `${hlsOutputDir}/${updated.id}`);
            }

            yield* syncMetadata(updated, chapters);
            return json(updated);
          }),
        ),
    },
    "/media/*": {
      GET: (req: BunRequest<"/media/*">) => {
        const url = new URL(req.url);
        const rel = decodeURIComponent(url.pathname.slice("/media/".length));
        if (rel.includes("..")) {
          return new Response("Forbidden", { status: 403, headers: corsHeaders });
        }
        const file = Bun.file(`${hlsOutputDir}/${rel}`);
        return new Response(file, { headers: corsHeaders });
      },
    },
  },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const videoId = url.searchParams.get("videoId");
      if (!videoId) return new Response("videoId required", { status: 400 });
      if (server.upgrade(req, { data: { videoId } })) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    }
    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws: ServerWebSocket<{ videoId: string }>) {
      const { videoId } = ws.data;
      let set = progressSockets.get(videoId);
      if (!set) {
        set = new Set();
        progressSockets.set(videoId, set);
      }
      set.add(ws);
    },
    message() {},
    close(ws: ServerWebSocket<{ videoId: string }>) {
      const set = progressSockets.get(ws.data.videoId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) progressSockets.delete(ws.data.videoId);
      }
    },
  },
  error(error) {
    process.stderr.write(`Unhandled server error: ${String(error)}\n`);
    return new Response("Internal Server Error", { status: 500 });
  },
});

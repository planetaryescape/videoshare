import { SqliteClient } from "@effect/sql-sqlite-bun"
import { VideoRepository } from "@videoshare/shared/VideoRepository"
import { Chapter, ChapterId, Video, VideoId } from "@videoshare/shared/Video"
import { generateSlug } from "@videoshare/shared/Slug"
import { migrate } from "@videoshare/shared/Migrations"
import { errorStatus, VideoNotFoundError } from "@videoshare/shared/VideoErrors"
import type { PersistenceError, SlugAlreadyExistsError } from "@videoshare/shared/VideoErrors"
import { Cause, Effect, Option } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import type { ServerWebSocket } from "bun"
import { pushToProd } from "./src/prod"

const dbFilename = "./videoshare-admin.db"
const hlsOutputDir = "./videoshare-hls-output"
const tempDir = "./tmp"

if (!existsSync(tempDir)) await mkdir(tempDir, { recursive: true })
if (!existsSync(hlsOutputDir)) await mkdir(hlsOutputDir, { recursive: true })

const sqlLayer = SqliteClient.layer({ filename: dbFilename })
await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)))

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

const progressSockets = new Map<string, Set<ServerWebSocket<{ videoId: string }>>>()

const emitProgress = (videoId: string, payload: { stage: string; pct: number }) => {
  const sockets = progressSockets.get(videoId)
  if (!sockets) return
  const frame = JSON.stringify({ videoId, ...payload })
  for (const ws of sockets) ws.send(frame)
}

const probeDuration = async (path: string): Promise<number> => {
  const out = await Bun.$`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${path}`.text()
  return parseFloat(out.trim())
}

const runFfmpegWithProgress = async (
  args: string[],
  cwd: string,
  totalSec: number,
  onPct: (pct: number) => void,
): Promise<void> => {
  const proc = Bun.spawn(["ffmpeg", "-progress", "pipe:1", "-nostats", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const [key, raw] = line.split("=")
      if (key === "out_time_us" && totalSec > 0) {
        const sec = Number(raw) / 1_000_000
        onPct(Math.min(99, Math.round((sec / totalSec) * 100)))
      }
    }
  }

  if ((await proc.exited) !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`ffmpeg failed: ${stderr}`)
  }
}

const transcode = async (videoId: string, file: File): Promise<number> => {
  const tempPath = `${process.cwd()}/${tempDir}/${videoId}.mp4`
  await Bun.write(tempPath, file)

  const outputDir = `${hlsOutputDir}/${videoId}`
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true })
  }

  const duration = await probeDuration(tempPath)
  emitProgress(videoId, { stage: "transcoding", pct: 0 })

  await runFfmpegWithProgress([
    "-i", tempPath,
    "-vf", "fps=30,scale=min(1920\\,iw):-2:force_original_aspect_ratio=decrease,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "21",
    "-profile:v", "high",
    "-level", "4.1",
    "-g", "60",
    "-keyint_min", "60",
    "-sc_threshold", "0",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "48000",
    "-f", "hls",
    "-hls_time", "6",
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",
    "output.m3u8",
  ], outputDir, duration, (pct) => emitProgress(videoId, { stage: "transcoding", pct }))

  emitProgress(videoId, { stage: "poster", pct: 99 })

  const procPoster = Bun.spawn([
    "ffmpeg",
    "-i", tempPath,
    "-ss", "1",
    "-vf", "scale=min(1920\\,iw):-2:force_original_aspect_ratio=decrease,format=yuv420p",
    "-frames:v", "1",
    "poster.jpg",
  ], { cwd: outputDir })

  if ((await procPoster.exited) !== 0) {
    const stderr = await new Response(procPoster.stderr).text()
    throw new Error(`Poster extraction failed: ${stderr}`)
  }

  if (existsSync(tempPath)) {
    await rm(tempPath)
  }

  emitProgress(videoId, { stage: "done", pct: 100 })
  return isNaN(duration) ? 0 : duration
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  })

type RouteError = PersistenceError | SlugAlreadyExistsError | VideoNotFoundError

const failureResponse = (tag: keyof typeof errorStatus, message: string) =>
  Effect.succeed(json({ error: message }, errorStatus[tag] ?? 500))

const runRoute = (
  effect: Effect.Effect<Response, RouteError, VideoRepository | SqlClient.SqlClient>
) =>
  effect.pipe(
    Effect.catchTags({
      PersistenceError: (e) => failureResponse("PersistenceError", e.message),
      SlugAlreadyExistsError: (e) => failureResponse("SlugAlreadyExistsError", e.message),
      VideoNotFoundError: (e) => failureResponse("VideoNotFoundError", e.message),
    }),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        console.error(Cause.pretty(cause))
        return json({ error: "Internal Server Error" }, 500)
      })
    ),
    Effect.provide(VideoRepository.layerNoDeps),
    Effect.provide(sqlLayer),
    Effect.runPromise
  )

Bun.serve({
  port: 3001,
  maxRequestBodySize: 1024 * 1024 * 1024 * 5,
  routes: {
    "/api/videos": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      GET: () =>
        runRoute(
          Effect.gen(function*() {
            const repo = yield* VideoRepository
            return json(yield* repo.list())
          })
        ),
      POST: (req) =>
        runRoute(
          Effect.gen(function*() {
            const repo = yield* VideoRepository
            const body = yield* Effect.promise(
              () => req.json() as Promise<{ title: string; description?: string }>
            )
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
            })
            return json(yield* repo.create(video), 201)
          })
        ),
    },
    "/api/videos/:id": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      GET: (req) =>
        runRoute(
          Effect.gen(function*() {
            const repo = yield* VideoRepository
            const video = yield* repo.findById(VideoId.make(req.params.id))
            if (Option.isNone(video)) {
              return yield* new VideoNotFoundError({ slug: req.params.id })
            }
            const chapters = yield* repo.listChapters(video.value.id)
            return json({ video: video.value, chapters })
          })
        ),
      PUT: (req) =>
        runRoute(
          Effect.gen(function*() {
            const repo = yield* VideoRepository
            const found = yield* repo.findById(VideoId.make(req.params.id))
            if (Option.isNone(found)) {
              return yield* new VideoNotFoundError({ slug: req.params.id })
            }
            const body = yield* Effect.promise(
              () =>
                req.json() as Promise<{
                  title?: string
                  description?: string
                  chapters?: Array<{ id?: string; title: string; startSec: number }>
                }>
            )
            const updated = new Video({
              ...found.value,
              title: body.title ?? found.value.title,
              description: body.description ?? found.value.description,
            })
            const video = yield* repo.update(updated)

            if (body.chapters !== undefined) {
              const chapters = body.chapters.map((ch, index) =>
                new Chapter({
                  id: ChapterId.make(ch.id ?? crypto.randomUUID()),
                  videoId: video.id,
                  title: ch.title,
                  startSec: ch.startSec,
                  sortOrder: index,
                })
              )
              yield* repo.replaceChapters(video.id, chapters)
            }

            const chapters = yield* repo.listChapters(video.id)
            return json({ video, chapters })
          })
        ),
      DELETE: (req) =>
        runRoute(
          Effect.gen(function*() {
            const id = req.params.id
            const repo = yield* VideoRepository
            yield* repo.delete(VideoId.make(id))
            const outputPath = `${hlsOutputDir}/${id}`
            yield* Effect.promise(async () => {
              if (existsSync(outputPath)) {
                await rm(outputPath, { recursive: true, force: true })
              }
            })
            return json({ success: true })
          })
        ),
    },
    "/api/upload": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      POST: (req) =>
        runRoute(
          Effect.gen(function*() {
            const repo = yield* VideoRepository
            const formData = yield* Effect.promise(() => req.formData())
            const videoIdField = formData.get("videoId")
            const file = formData.get("file")
            if (typeof videoIdField !== "string" || !(file instanceof File)) {
              return json({ error: "videoId and file are required" }, 400)
            }
            const videoId = videoIdField

            const found = yield* repo.findById(VideoId.make(videoId))
            if (Option.isNone(found)) {
              return yield* new VideoNotFoundError({ slug: videoId })
            }

            const duration = yield* Effect.promise(() => transcode(videoId, file))

            const updatedVideo = new Video({
              ...found.value,
              hlsKey: `media/${videoId}/output.m3u8`,
              posterKey: `media/${videoId}/poster.jpg`,
              durationSec: isNaN(duration) ? 0 : duration,
            })
            return json(yield* repo.update(updatedVideo))
          })
        ),
    },
    "/api/publish/:id": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      POST: (req) =>
        runRoute(
          Effect.gen(function*() {
            const repo = yield* VideoRepository
            const found = yield* repo.findById(VideoId.make(req.params.id))
            if (Option.isNone(found)) {
              return yield* new VideoNotFoundError({ slug: req.params.id })
            }
            if (!found.value.hlsKey) {
              return json({ error: "Video must be transcoded before publishing" }, 400)
            }
            const publishedVideo = new Video({
              ...found.value,
              publishedAt: found.value.publishedAt ?? Date.now(),
            })
            const updated = yield* repo.update(publishedVideo)
            const chapters = yield* repo.listChapters(updated.id)
            yield* Effect.promise(() =>
              pushToProd(updated, chapters, `${hlsOutputDir}/${updated.id}`)
            )
            return json(updated)
          })
        ),
    },
    "/media/*": {
      GET: (req) => {
        const url = new URL(req.url)
        const rel = decodeURIComponent(url.pathname.slice("/media/".length))
        if (rel.includes("..")) {
          return new Response("Forbidden", { status: 403, headers: corsHeaders })
        }
        const file = Bun.file(`${hlsOutputDir}/${rel}`)
        return new Response(file, { headers: corsHeaders })
      },
    },
  },
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/ws") {
      const videoId = url.searchParams.get("videoId")
      if (!videoId) return new Response("videoId required", { status: 400 })
      if (server.upgrade(req, { data: { videoId } })) return undefined
      return new Response("Upgrade failed", { status: 400 })
    }
    return new Response("Not Found", { status: 404 })
  },
  websocket: {
    open(ws: ServerWebSocket<{ videoId: string }>) {
      const { videoId } = ws.data
      let set = progressSockets.get(videoId)
      if (!set) {
        set = new Set()
        progressSockets.set(videoId, set)
      }
      set.add(ws)
    },
    message() {},
    close(ws: ServerWebSocket<{ videoId: string }>) {
      const set = progressSockets.get(ws.data.videoId)
      if (set) {
        set.delete(ws)
        if (set.size === 0) progressSockets.delete(ws.data.videoId)
      }
    },
  },
  error(error) {
    console.error("Unhandled server error:", error)
    return new Response("Internal Server Error", { status: 500 })
  },
})

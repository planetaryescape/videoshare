import { SqliteClient } from "@effect/sql-sqlite-bun"
import { VideoRepository } from "@videoshare/shared/VideoRepository"
import { Video, Chapter } from "@videoshare/shared/Video"
import type { VideoId } from "@videoshare/shared/Video"
import { generateSlug } from "@videoshare/shared/Slug"
import { migrate } from "@videoshare/shared/Migrations"
import { statusForError } from "@videoshare/shared/VideoErrors"
import { Effect, Option } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"

const dbFilename = "./videoshare-admin.db"
const hlsOutputDir = "./videoshare-hls-output"
const tempDir = "./tmp"

if (!existsSync(tempDir)) await mkdir(tempDir, { recursive: true })
if (!existsSync(hlsOutputDir)) await mkdir(hlsOutputDir, { recursive: true })

const sqlLayer = SqliteClient.layer({ filename: dbFilename })
await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)))

const runRepo = <A>(effect: Effect.Effect<A, unknown, VideoRepository>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(VideoRepository.layerNoDeps),
      Effect.provide(sqlLayer)
    )
  )

const runSql = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer)))

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  })

const handleError = (e: unknown) => {
  console.error(e)
  const status = e instanceof Object && "_tag" in e
    ? statusForError(e as { _tag: string })
    : 500
  return json({ error: String(e) }, status)
}

Bun.serve({
  port: 3001,
  routes: {
    "/api/videos": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      GET: async () => {
        try {
          const videos = await runRepo(
            Effect.gen(function*() {
              const repo = yield* VideoRepository
              return yield* repo.list()
            })
          )
          return json(videos)
        } catch (e) {
          return handleError(e)
        }
      },
      POST: async (req) => {
        try {
          const { title, description } = await req.json() as { title: string; description?: string }
          const video = new Video({
            id: crypto.randomUUID() as VideoId,
            slug: generateSlug(),
            title,
            description: description ?? null,
            posterKey: null,
            hlsKey: "",
            durationSec: 0,
            passwordHash: null,
            createdAt: Date.now(),
            publishedAt: null,
          })
          const created = await runRepo(
            Effect.gen(function*() {
              const repo = yield* VideoRepository
              return yield* repo.create(video)
            })
          )
          return json(created, 201)
        } catch (e) {
          return handleError(e)
        }
      },
    },
    "/api/videos/:id": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      GET: async (req) => {
        try {
          const url = new URL(req.url)
          const id = url.pathname.split("/").pop()!
          const result = await runRepo(
            Effect.gen(function*() {
              const repo = yield* VideoRepository
              const videos = yield* repo.list()
              const video = videos.find((v) => v.id === id)
              if (!video) {
                return Option.none<{ video: Video; chapters: ReadonlyArray<Chapter> }>()
              }
              const chapters = yield* repo.listChapters(video.id)
              return Option.some({ video, chapters })
            })
          )
          if (Option.isNone(result)) {
            return json({ error: "Video not found" }, 404)
          }
          return json(result.value)
        } catch (e) {
          return handleError(e)
        }
      },
      DELETE: async (req) => {
        try {
          const url = new URL(req.url)
          const id = url.pathname.split("/").pop()!
          await runSql(
            Effect.gen(function*() {
              const sql = yield* SqlClient.SqlClient
              yield* sql`DELETE FROM chapters WHERE video_id = ${id}`
              yield* sql`DELETE FROM videos WHERE id = ${id}`
            })
          )
          const outputPath = `${hlsOutputDir}/${id}`
          if (existsSync(outputPath)) {
            await rm(outputPath, { recursive: true, force: true })
          }
          return json({ success: true })
        } catch (e) {
          return handleError(e)
        }
      },
    },
    "/api/upload": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      POST: async (req) => {
        try {
          const formData = await req.formData()
          const videoId = formData.get("videoId") as string | null
          const file = formData.get("file") as File | null
          if (!videoId || !file) {
            return json({ error: "videoId and file are required" }, 400)
          }

          const tempPath = `${tempDir}/${videoId}.mp4`
          await Bun.write(tempPath, file)

          const outputDir = `${hlsOutputDir}/${videoId}`
          if (!existsSync(outputDir)) {
            await mkdir(outputDir, { recursive: true })
          }

          const procHls = Bun.spawn([
            "ffmpeg",
            "-i", tempPath,
            "-vf", "fps=30,scale=min(1920,iw):-2:force_original_aspect_ratio=decrease,format=yuv420p",
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
          ], { cwd: outputDir })

          const hlsExit = await procHls.exited
          if (hlsExit !== 0) {
            const stderr = await new Response(procHls.stderr).text()
            throw new Error(`HLS transcoding failed: ${stderr}`)
          }

          const procPoster = Bun.spawn([
            "ffmpeg",
            "-i", tempPath,
            "-ss", "1",
            "-vf", "scale=min(1920,iw):-2:force_original_aspect_ratio=decrease,format=yuv420p",
            "-frames:v", "1",
            "poster.jpg",
          ], { cwd: outputDir })

          const posterExit = await procPoster.exited
          if (posterExit !== 0) {
            const stderr = await new Response(procPoster.stderr).text()
            throw new Error(`Poster extraction failed: ${stderr}`)
          }

          const durationStr = await Bun.$`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${tempPath}`.text()
          const duration = parseFloat(durationStr.trim())

          const updated = await runRepo(
            Effect.gen(function*() {
              const repo = yield* VideoRepository
              const videos = yield* repo.list()
              const video = videos.find((v) => v.id === videoId)
              if (!video) throw new Error("Video not found")
              const updatedVideo = new Video({
                ...video,
                hlsKey: `${hlsOutputDir}/${videoId}/output.m3u8`,
                posterKey: `${hlsOutputDir}/${videoId}/poster.jpg`,
                durationSec: isNaN(duration) ? 0 : duration,
              })
              return yield* repo.update(updatedVideo)
            })
          )

          if (existsSync(tempPath)) {
            await rm(tempPath)
          }

          return json(updated)
        } catch (e) {
          return handleError(e)
        }
      },
    },
    "/api/publish/:id": {
      OPTIONS: () => new Response(null, { headers: corsHeaders }),
      POST: async (req) => {
        try {
          const url = new URL(req.url)
          const id = url.pathname.split("/").pop()!
          const updated = await runRepo(
            Effect.gen(function*() {
              const repo = yield* VideoRepository
              const videos = yield* repo.list()
              const video = videos.find((v) => v.id === id)
              if (!video) throw new Error("Video not found")
              const publishedVideo = new Video({
                ...video,
                publishedAt: Date.now(),
              })
              return yield* repo.update(publishedVideo)
            })
          )
          return json(updated)
        } catch (e) {
          return handleError(e)
        }
      },
    },
  },
  error(error) {
    console.error("Unhandled server error:", error)
    return new Response("Internal Server Error", { status: 500 })
  },
})

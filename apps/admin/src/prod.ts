import { S3Client } from "bun"
import { readdir } from "node:fs/promises"
import type { Chapter, Video } from "@videoshare/shared/Video"

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env ${name}`)
  }
  return value
}

const accountId = () => required("CLOUDFLARE_DEFAULT_ACCOUNT_ID")
const apiToken = () => required("CLOUDFLARE_API_TOKEN")
const databaseId = () => required("CLOUDFLARE_D1_DATABASE_ID")

const r2 = () =>
  new S3Client({
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET"),
    endpoint: `https://${accountId()}.r2.cloudflarestorage.com`,
  })

type D1Param = string | number | null

const d1Query = async (sql: string, params: ReadonlyArray<D1Param>): Promise<void> => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId()}/d1/database/${databaseId()}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  )
  if (!response.ok) {
    throw new Error(`D1 query failed (${response.status}): ${await response.text()}`)
  }
  const result = (await response.json()) as { success: boolean; errors?: ReadonlyArray<{ message: string }> }
  if (!result.success) {
    throw new Error(`D1 query error: ${result.errors?.map((e) => e.message).join(", ") ?? "unknown"}`)
  }
}

const contentType = (key: string): string => {
  if (key.endsWith(".m3u8")) return "application/vnd.apple.mpegurl"
  if (key.endsWith(".ts")) return "video/mp2t"
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg"
  if (key.endsWith(".vtt")) return "text/vtt"
  return "application/octet-stream"
}

const uploadDir = async (localDir: string, keyPrefix: string): Promise<void> => {
  const client = r2()
  const entries = await readdir(localDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const key = `${keyPrefix}/${entry.name}`
    await client.write(key, Bun.file(`${localDir}/${entry.name}`), {
      type: contentType(key),
    })
  }
}

const upsertVideo = async (video: Video): Promise<void> => {
  await d1Query(
    `INSERT INTO videos (id, slug, title, description, poster_key, hls_key, duration_sec, password_hash, created_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       slug = excluded.slug,
       title = excluded.title,
       description = excluded.description,
       poster_key = excluded.poster_key,
       hls_key = excluded.hls_key,
       duration_sec = excluded.duration_sec,
       password_hash = excluded.password_hash,
       published_at = excluded.published_at`,
    [
      video.id,
      video.slug,
      video.title,
      video.description,
      video.posterKey,
      video.hlsKey,
      video.durationSec,
      video.passwordHash,
      video.createdAt,
      video.publishedAt,
    ],
  )
}

const replaceChapters = async (videoId: string, chapters: ReadonlyArray<Chapter>): Promise<void> => {
  await d1Query(`DELETE FROM chapters WHERE video_id = ?`, [videoId])
  for (const chapter of chapters) {
    await d1Query(
      `INSERT INTO chapters (id, video_id, title, start_sec, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [chapter.id, chapter.videoId, chapter.title, chapter.startSec, chapter.sortOrder],
    )
  }
}

export const pushToProd = async (
  video: Video,
  chapters: ReadonlyArray<Chapter>,
  localMediaDir: string,
): Promise<void> => {
  await uploadDir(localMediaDir, `media/${video.id}`)
  await upsertVideo(video)
  await replaceChapters(video.id, chapters)
}

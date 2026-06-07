import { Array, Context, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { Chapter, type ChapterId, Video, type VideoId } from "./Video.ts"
import { PersistenceError, SlugAlreadyExistsError } from "./VideoErrors.ts"

interface VideoRow {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly description: string | null
  readonly poster_key: string | null
  readonly hls_key: string
  readonly duration_sec: number
  readonly password_hash: string | null
  readonly created_at: number
  readonly published_at: number | null
}

interface ChapterRow {
  readonly id: string
  readonly video_id: string
  readonly title: string
  readonly start_sec: number
  readonly sort_order: number
}

const toVideo = (row: VideoRow): Video =>
  new Video({
    id: row.id as VideoId,
    slug: row.slug as Video["slug"],
    title: row.title,
    description: row.description,
    posterKey: row.poster_key,
    hlsKey: row.hls_key,
    durationSec: row.duration_sec,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    publishedAt: row.published_at
  })

const toChapter = (row: ChapterRow): Chapter =>
  new Chapter({
    id: row.id as ChapterId,
    videoId: row.video_id as VideoId,
    title: row.title,
    startSec: row.start_sec,
    sortOrder: row.sort_order
  })

export class VideoRepository extends Context.Service<VideoRepository, {
  findById(id: VideoId): Effect.Effect<Option.Option<Video>, PersistenceError>
  findBySlug(slug: string): Effect.Effect<Option.Option<Video>, PersistenceError>
  list(): Effect.Effect<ReadonlyArray<Video>, PersistenceError>
  create(video: Video): Effect.Effect<Video, PersistenceError | SlugAlreadyExistsError>
  update(video: Video): Effect.Effect<Video, PersistenceError>
  delete(id: VideoId): Effect.Effect<void, PersistenceError>
  listChapters(videoId: VideoId): Effect.Effect<ReadonlyArray<Chapter>, PersistenceError>
  replaceChapters(
    videoId: VideoId,
    chapters: ReadonlyArray<Chapter>
  ): Effect.Effect<void, PersistenceError>
}>()("videoshare/VideoRepository") {
  static readonly layerNoDeps: Layer.Layer<VideoRepository, never, SqlClient.SqlClient> =
    Layer.effect(
      VideoRepository,
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient

        const fail = (operation: string) =>
          Effect.mapError(
            (cause: unknown) => new PersistenceError({ operation, cause })
          )

        const findById = Effect.fn("VideoRepository.findById")(function*(id: VideoId) {
          const rows = yield* sql<VideoRow>`SELECT * FROM videos WHERE id = ${id}`
          return Array.head(rows).pipe(Option.map(toVideo))
        }, fail("findById"))

        const findBySlug = Effect.fn("VideoRepository.findBySlug")(function*(slug: string) {
          const rows = yield* sql<VideoRow>`SELECT * FROM videos WHERE slug = ${slug}`
          return Array.head(rows).pipe(Option.map(toVideo))
        }, fail("findBySlug"))

        const list = Effect.fn("VideoRepository.list")(function*() {
          const rows = yield* sql<VideoRow>`SELECT * FROM videos ORDER BY created_at DESC`
          return rows.map(toVideo)
        }, fail("list"))

        const create = Effect.fn("VideoRepository.create")(function*(video: Video) {
          const existing =
            yield* sql<{ readonly c: number }>`SELECT COUNT(*) AS c FROM videos WHERE slug = ${video.slug}`
          if ((existing[0]?.c ?? 0) > 0) {
            return yield* new SlugAlreadyExistsError({ slug: video.slug })
          }
          yield* sql`
            INSERT INTO videos (id, slug, title, description, poster_key, hls_key, duration_sec, password_hash, created_at, published_at)
            VALUES (${video.id}, ${video.slug}, ${video.title}, ${video.description}, ${video.posterKey}, ${video.hlsKey}, ${video.durationSec}, ${video.passwordHash}, ${video.createdAt}, ${video.publishedAt})
          `
          return video
        }, fail("create"))

        const update = Effect.fn("VideoRepository.update")(function*(video: Video) {
          yield* sql`
            UPDATE videos SET
              slug = ${video.slug},
              title = ${video.title},
              description = ${video.description},
              poster_key = ${video.posterKey},
              hls_key = ${video.hlsKey},
              duration_sec = ${video.durationSec},
              password_hash = ${video.passwordHash},
              published_at = ${video.publishedAt}
            WHERE id = ${video.id}
          `
          return video
        }, fail("update"))

        const del = Effect.fn("VideoRepository.delete")(function*(id: VideoId) {
          yield* sql`DELETE FROM chapters WHERE video_id = ${id}`
          yield* sql`DELETE FROM videos WHERE id = ${id}`
        }, fail("delete"))

        const listChapters = Effect.fn("VideoRepository.listChapters")(function*(videoId: VideoId) {
          const rows =
            yield* sql<ChapterRow>`SELECT * FROM chapters WHERE video_id = ${videoId} ORDER BY sort_order ASC`
          return rows.map(toChapter)
        }, fail("listChapters"))

        const replaceChapters = Effect.fn("VideoRepository.replaceChapters")(function*(
          videoId: VideoId,
          chapters: ReadonlyArray<Chapter>
        ) {
          yield* sql`DELETE FROM chapters WHERE video_id = ${videoId}`
          for (const ch of chapters) {
            yield* sql`
              INSERT INTO chapters (id, video_id, title, start_sec, sort_order)
              VALUES (${ch.id}, ${ch.videoId}, ${ch.title}, ${ch.startSec}, ${ch.sortOrder})
            `
          }
        }, fail("replaceChapters"))

        return VideoRepository.of({
          findById,
          findBySlug,
          list,
          create,
          update,
          delete: del,
          listChapters,
          replaceChapters
        })
      })
    )
}

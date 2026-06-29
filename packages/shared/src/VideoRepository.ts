import { Array, Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Chapter, ChapterId, Slug, Video, VideoId } from "./Video.ts";
import { PersistenceError, SlugAlreadyExistsError } from "./VideoErrors.ts";

const wrapSqlError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> =>
    Effect.mapError(effect, (cause) => new PersistenceError({ operation, cause }));

interface VideoRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly poster_key: string | null;
  readonly hls_key: string;
  readonly duration_sec: number;
  readonly password_hash: string | null;
  readonly created_at: number;
  readonly published_at: number | null;
  readonly updated_at: number | null;
}

interface ChapterRow {
  readonly id: string;
  readonly video_id: string;
  readonly title: string;
  readonly start_sec: number;
  readonly sort_order: number;
}

const toVideo = (row: VideoRow): Effect.Effect<Video, PersistenceError> =>
  Effect.try({
    try: () =>
      new Video({
        id: VideoId.make(row.id),
        slug: Slug.make(row.slug),
        title: row.title,
        description: row.description,
        posterKey: row.poster_key,
        hlsKey: row.hls_key,
        durationSec: row.duration_sec,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
      }),
    catch: (cause) => new PersistenceError({ operation: "decodeVideo", cause }),
  });

const toChapter = (row: ChapterRow): Effect.Effect<Chapter, PersistenceError> =>
  Effect.try({
    try: () =>
      new Chapter({
        id: ChapterId.make(row.id),
        videoId: VideoId.make(row.video_id),
        title: row.title,
        startSec: row.start_sec,
        sortOrder: row.sort_order,
      }),
    catch: (cause) => new PersistenceError({ operation: "decodeChapter", cause }),
  });

export class VideoRepository extends Context.Service<
  VideoRepository,
  {
    findById(id: VideoId): Effect.Effect<Option.Option<Video>, PersistenceError>;
    findBySlug(slug: string): Effect.Effect<Option.Option<Video>, PersistenceError>;
    list(): Effect.Effect<ReadonlyArray<Video>, PersistenceError>;
    create(video: Video): Effect.Effect<Video, PersistenceError | SlugAlreadyExistsError>;
    update(video: Video): Effect.Effect<Video, PersistenceError>;
    delete(id: VideoId): Effect.Effect<void, PersistenceError>;
    listChapters(videoId: VideoId): Effect.Effect<ReadonlyArray<Chapter>, PersistenceError>;
    replaceChapters(
      videoId: VideoId,
      chapters: ReadonlyArray<Chapter>,
    ): Effect.Effect<void, PersistenceError>;
  }
>()("videoshare/VideoRepository") {
  static readonly layerNoDeps: Layer.Layer<VideoRepository, never, SqlClient.SqlClient> =
    Layer.effect(
      VideoRepository,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const findById = Effect.fn("VideoRepository.findById")(function* (id: VideoId) {
          const rows = yield* sql<VideoRow>`SELECT * FROM videos WHERE id = ${id}`;
          const head = Array.head(rows);
          if (Option.isNone(head)) return Option.none<Video>();
          return Option.some(yield* toVideo(head.value));
        }, wrapSqlError("findById"));

        const findBySlug = Effect.fn("VideoRepository.findBySlug")(function* (slug: string) {
          const rows = yield* sql<VideoRow>`SELECT * FROM videos WHERE slug = ${slug}`;
          const head = Array.head(rows);
          if (Option.isNone(head)) return Option.none<Video>();
          return Option.some(yield* toVideo(head.value));
        }, wrapSqlError("findBySlug"));

        const list = Effect.fn("VideoRepository.list")(function* () {
          const rows = yield* sql<VideoRow>`SELECT * FROM videos ORDER BY created_at DESC`;
          return yield* Effect.all(rows.map(toVideo));
        }, wrapSqlError("list"));

        const create = Effect.fn("VideoRepository.create")(function* (video: Video) {
          const existing = yield* sql<{
            readonly c: number;
          }>`SELECT COUNT(*) AS c FROM videos WHERE slug = ${video.slug}`;
          if ((existing[0]?.c ?? 0) > 0) {
            return yield* new SlugAlreadyExistsError({ slug: video.slug });
          }
          yield* sql`
            INSERT INTO videos (id, slug, title, description, poster_key, hls_key, duration_sec, password_hash, created_at, published_at, updated_at)
            VALUES (${video.id}, ${video.slug}, ${video.title}, ${video.description}, ${video.posterKey}, ${video.hlsKey}, ${video.durationSec}, ${video.passwordHash}, ${video.createdAt}, ${video.publishedAt}, ${video.updatedAt})
          `;
          return video;
        }, wrapSqlError("create"));

        const update = Effect.fn("VideoRepository.update")(function* (video: Video) {
          yield* sql`
            UPDATE videos SET
              slug = ${video.slug},
              title = ${video.title},
              description = ${video.description},
              poster_key = ${video.posterKey},
              hls_key = ${video.hlsKey},
              duration_sec = ${video.durationSec},
              password_hash = ${video.passwordHash},
              published_at = ${video.publishedAt},
              updated_at = ${video.updatedAt}
            WHERE id = ${video.id}
          `;
          return video;
        }, wrapSqlError("update"));

        const del = Effect.fn("VideoRepository.delete")(function* (id: VideoId) {
          yield* sql`DELETE FROM chapters WHERE video_id = ${id}`;
          yield* sql`DELETE FROM videos WHERE id = ${id}`;
        }, wrapSqlError("delete"));

        const listChapters = Effect.fn("VideoRepository.listChapters")(function* (
          videoId: VideoId,
        ) {
          const rows =
            yield* sql<ChapterRow>`SELECT * FROM chapters WHERE video_id = ${videoId} ORDER BY sort_order ASC`;
          return yield* Effect.all(rows.map(toChapter));
        }, wrapSqlError("listChapters"));

        const replaceChapters = Effect.fn("VideoRepository.replaceChapters")(function* (
          videoId: VideoId,
          chapters: ReadonlyArray<Chapter>,
        ) {
          yield* sql`DELETE FROM chapters WHERE video_id = ${videoId}`;
          for (const ch of chapters) {
            yield* sql`
              INSERT INTO chapters (id, video_id, title, start_sec, sort_order)
              VALUES (${ch.id}, ${ch.videoId}, ${ch.title}, ${ch.startSec}, ${ch.sortOrder})
            `;
          }
        }, wrapSqlError("replaceChapters"));

        return VideoRepository.of({
          findById,
          findBySlug,
          list,
          create,
          update,
          delete: del,
          listChapters,
          replaceChapters,
        });
      }),
    );
}

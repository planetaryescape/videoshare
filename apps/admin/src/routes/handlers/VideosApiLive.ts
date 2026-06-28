import { HttpApiBuilder } from "effect/unstable/httpapi";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { Video, VideoId } from "@videoshare/shared/Video";
import { VideoNotFoundError } from "@videoshare/shared/VideoErrors";
import { generateSlug } from "@videoshare/shared/Slug";
import { Effect, Option } from "effect";
import { Storage } from "../../services/Storage.ts";
import { chaptersFromInput } from "../../schemas/Chapters.ts";
import { AdminApi } from "../AdminApi.ts";

export const VideosApiLive = HttpApiBuilder.group(AdminApi, "videos", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* VideoRepository;
    const storage = yield* Storage;

    return handlers
      .handle("listVideos", () => repo.list())
      .handle("getVideo", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* repo.findById(VideoId.make(params.id));
          if (Option.isNone(found)) {
            return yield* new VideoNotFoundError({ slug: params.id });
          }
          const chapters = yield* repo.listChapters(found.value.id);
          return { video: found.value, chapters };
        }),
      )
      .handle("createVideo", ({ payload }) =>
        Effect.gen(function* () {
          const video = new Video({
            id: VideoId.make(crypto.randomUUID()),
            slug: generateSlug(),
            title: payload.title,
            description: payload.description ?? null,
            posterKey: null,
            hlsKey: "",
            durationSec: 0,
            passwordHash: null,
            createdAt: Date.now(),
            publishedAt: null,
            updatedAt: null,
          });
          return yield* repo.create(video);
        }),
      )
      .handle("updateVideo", ({ params, payload }) =>
        Effect.gen(function* () {
          const found = yield* repo.findById(VideoId.make(params.id));
          if (Option.isNone(found)) {
            return yield* new VideoNotFoundError({ slug: params.id });
          }
          const updated = new Video({
            ...found.value,
            title: payload.title ?? found.value.title,
            description: payload.description ?? found.value.description,
            updatedAt: Date.now(),
          });
          const video = yield* repo.update(updated);

          if (payload.chapters !== undefined) {
            yield* repo.replaceChapters(video.id, chaptersFromInput(video.id, payload.chapters));
          }

          const chapters = yield* repo.listChapters(video.id);
          return { video, chapters };
        }),
      )
      .handle("deleteVideo", ({ params }) =>
        Effect.gen(function* () {
          const id = VideoId.make(params.id);
          const found = yield* repo.findById(id);
          if (Option.isNone(found)) {
            return yield* new VideoNotFoundError({ slug: params.id });
          }
          yield* storage.removeVideoDir(params.id);
          yield* repo.delete(id);
          return { success: true as const };
        }),
      );
  }),
);

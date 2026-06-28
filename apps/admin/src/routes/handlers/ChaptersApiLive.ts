import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { Chapter, ChapterId, VideoId } from "@videoshare/shared/Video";
import { VideoNotFoundError } from "@videoshare/shared/VideoErrors";
import { AdminApi } from "../AdminApi.ts";

export const ChaptersApiLive = HttpApiBuilder.group(AdminApi, "chapters", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* VideoRepository;

    return handlers.handle("replaceChapters", ({ params, payload }) =>
      Effect.gen(function* () {
        const found = yield* repo.findById(VideoId.make(params.videoId));
        if (Option.isNone(found)) {
          return yield* new VideoNotFoundError({ slug: params.videoId });
        }
        const chapters: ReadonlyArray<Chapter> = payload.map(
          (ch, index) =>
            new Chapter({
              id: ChapterId.make(ch.id ?? crypto.randomUUID()),
              videoId: VideoId.make(params.videoId),
              title: ch.title,
              startSec: ch.startSec,
              sortOrder: index,
            }),
        );
        yield* repo.replaceChapters(found.value.id, chapters);
        return chapters;
      }),
    );
  }),
);

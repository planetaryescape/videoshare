import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { VideoId } from "@videoshare/shared/Video";
import { VideoNotFoundError } from "@videoshare/shared/VideoErrors";
import { chaptersFromInput } from "../../schemas/Chapters.ts";
import { AdminApi } from "../AdminApi.ts";

export const ChaptersApiLive = HttpApiBuilder.group(AdminApi, "chapters", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* VideoRepository;

    return handlers.handle("replaceChapters", ({ params, payload }) =>
      Effect.gen(function* () {
        const found = yield* repo.findById(VideoId.make(params.videoId));
        if (Option.isNone(found)) {
          return yield* new VideoNotFoundError({ id: params.videoId });
        }
        const chapters = chaptersFromInput(VideoId.make(params.videoId), payload);
        yield* repo.replaceChapters(found.value.id, chapters);
        return chapters;
      }),
    );
  }),
);

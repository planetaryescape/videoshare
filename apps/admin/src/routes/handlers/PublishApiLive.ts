import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { Video, VideoId } from "@videoshare/shared/Video";
import { VideoNotFoundError } from "@videoshare/shared/VideoErrors";
import { Storage } from "../../services/Storage.ts";
import { ProdSync } from "../../prod.ts";
import { NotTranscodedError } from "../../errors/UploadErrors.ts";
import { AdminApi } from "../AdminApi.ts";

export const PublishApiLive = HttpApiBuilder.group(AdminApi, "publish", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* VideoRepository;
    const prod = yield* ProdSync;
    const storage = yield* Storage;

    return handlers.handle("publish", ({ params }) =>
      Effect.gen(function* () {
        const found = yield* repo.findById(VideoId.make(params.id));
        if (Option.isNone(found)) {
          return yield* new VideoNotFoundError({ slug: params.id });
        }
        if (!found.value.hlsKey) {
          return yield* new NotTranscodedError({ videoId: found.value.id });
        }

        const hasMedia = yield* prod.mediaExists(found.value.id);
        if (!hasMedia) {
          yield* prod.uploadMedia(found.value.id, storage.videoDir(found.value.id));
        }
        yield* prod.syncMetadata(found.value, yield* repo.listChapters(found.value.id));

        const publishedVideo = new Video({
          ...found.value,
          publishedAt: Date.now(),
        });
        return yield* repo.update(publishedVideo);
      }),
    );
  }),
);

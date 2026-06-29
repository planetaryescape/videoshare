import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerRequest } from "effect/unstable/http";
import { Effect } from "effect";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { Video, VideoId } from "@videoshare/shared/Video";
import { VideoNotFoundError } from "@videoshare/shared/VideoErrors";
import { ProgressBus } from "../../services/ProgressBus.ts";
import { Transcoder } from "../../services/Transcoder.ts";
import { Storage } from "../../services/Storage.ts";
import { ProdSync } from "../../prod.ts";
import { UploadValidationError } from "../../errors/UploadErrors.ts";
import { AdminApi } from "../AdminApi.ts";

export const UploadApiLive = HttpApiBuilder.group(AdminApi, "upload", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* VideoRepository;
    const transcoder = yield* Transcoder;
    const progress = yield* ProgressBus;
    const prod = yield* ProdSync;
    const storage = yield* Storage;

    return handlers.handleRaw("upload", ({ request }) =>
      Effect.gen(function* () {
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
          Effect.mapError(
            (cause) =>
              new UploadValidationError({
                reason: `Failed to read request: ${cause._tag}`,
              }),
          ),
        );
        const formData = yield* Effect.tryPromise({
          try: () => webRequest.formData(),
          catch: (cause) =>
            new UploadValidationError({
              reason: `Failed to parse form data: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        });
        const videoIdField = formData.get("videoId");
        const file = formData.get("file");
        if (typeof videoIdField !== "string" || !(file instanceof File)) {
          return yield* new UploadValidationError({ reason: "videoId and file are required" });
        }
        const videoId = videoIdField;

        const found = yield* repo.findById(VideoId.make(videoId));
        if (found._tag === "None") {
          return yield* new VideoNotFoundError({ id: videoId });
        }

        const duration = yield* transcoder.transcode(videoId, file);

        yield* progress.publish({ videoId, stage: "uploading-media", pct: 100 });
        yield* prod.uploadMedia(videoId, storage.videoDir(videoId));

        const updated = new Video({
          ...found.value,
          hlsKey: `media/${videoId}/master.m3u8`,
          posterKey: `media/${videoId}/poster.jpg`,
          durationSec: isNaN(duration) ? 0 : duration,
          updatedAt: Date.now(),
        });
        return yield* repo.update(updated);
      }),
    );
  }),
);

import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerRequest } from "effect/unstable/http";
import { Effect } from "effect";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { Asset, AssetId } from "@videoshare/shared/Asset";
import { AssetNotFoundError } from "@videoshare/shared/AssetErrors";
import { ProgressBus } from "../../services/ProgressBus.ts";
import { Transcoder } from "../../services/Transcoder.ts";
import { Storage } from "../../services/Storage.ts";
import { ProdSync } from "../../prod.ts";
import { UploadValidationError } from "../../errors/UploadErrors.ts";
import { AdminApi } from "../AdminApi.ts";

export const UploadApiLive = HttpApiBuilder.group(AdminApi, "upload", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepository;
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
        const assetIdField = formData.get("assetId");
        const file = formData.get("file");
        const posterField = formData.get("poster");
        if (typeof assetIdField !== "string" || !(file instanceof File)) {
          return yield* new UploadValidationError({ reason: "assetId and file are required" });
        }
        const assetId = assetIdField;
        const poster = posterField instanceof File && posterField.size > 0 ? posterField : null;

        const found = yield* repo.findById(AssetId.make(assetId));
        if (found._tag === "None") {
          return yield* new AssetNotFoundError({ id: assetId });
        }

        const { durationSec, kind } = yield* transcoder.transcode(assetId, file);

        if (poster) {
          yield* transcoder.writePoster(assetId, poster).pipe(
            Effect.catchTag(
              "PosterDecodeError",
              (err) =>
                new UploadValidationError({
                  reason: `Invalid cover image: ${err.message}`,
                }),
            ),
          );
        }

        yield* progress.publish({ assetId, stage: "uploading-media", pct: 100 });
        yield* prod.uploadMedia(assetId, storage.videoDir(assetId));

        const posterKey =
          poster !== null
            ? `media/${assetId}/poster.jpg`
            : kind === "video"
              ? `media/${assetId}/poster.jpg`
              : found.value.posterKey;
        const updated = new Asset({
          ...found.value,
          kind,
          mediaKey: `media/${assetId}/master.m3u8`,
          posterKey,
          durationSec: isNaN(durationSec) ? 0 : durationSec,
          updatedAt: Date.now(),
        });
        return yield* repo.update(updated);
      }),
    );
  }),
);

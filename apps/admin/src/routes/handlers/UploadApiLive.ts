import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerRequest } from "effect/unstable/http";
import { Effect, Option } from "effect";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Asset, AssetId } from "@videoshare/shared/Asset";
import { AssetNotFoundError } from "@videoshare/shared/AssetErrors";
import { MediaProcessor } from "../../services/MediaProcessor.ts";
import { UploadValidationError } from "../../errors/UploadErrors.ts";
import { AdminApi } from "../AdminApi.ts";
import {
  assertDirectAssetMutationAllowed,
  PublicationGate,
} from "../../services/PublicationGate.ts";
import { MediaReplacement } from "../../services/MediaReplacement.ts";

export const UploadApiLive = HttpApiBuilder.group(AdminApi, "upload", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepository;
    const processor = yield* MediaProcessor;
    const replacement = yield* MediaReplacement;
    const projects = yield* ProjectRepository;
    const gate = yield* PublicationGate;

    return handlers.handleRaw("upload", ({ request }) =>
      gate.serialize(
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
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: assetId });
          }

          yield* assertDirectAssetMutationAllowed(found.value, "upload", projects);
          const processed = yield* processor.process(assetId, file);

          if (poster && processed.kind !== "image") {
            yield* processor
              .writeCoverImage(assetId, poster)
              .pipe(
                Effect.catchTag(
                  "PosterDecodeError",
                  (err) =>
                    new UploadValidationError({ reason: `Invalid cover image: ${err.message}` }),
                ),
              );
          }

          const posterKey =
            processed.kind === "image"
              ? null
              : poster !== null || processed.kind === "video"
                ? `media/${assetId}/poster.jpg`
                : null;
          const updated = new Asset({
            ...found.value,
            kind: processed.kind,
            mediaKey: `media/${assetId}/${processed.filename}`,
            posterKey,
            durationSec: processed.durationSec,
            width: processed.width,
            height: processed.height,
            updatedAt: Date.now(),
          });
          return yield* replacement.replace(found.value, updated);
        }),
      ),
    );
  }),
);

import { Context, Effect, Layer } from "effect";
import type { Asset } from "@videoshare/shared/Asset";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import type {
  InvalidMediaShapeError,
  PersistenceError,
  ProdSyncError,
  SlugAlreadyExistsError,
} from "@videoshare/shared/AssetErrors";
import { r2KeyDir } from "@videoshare/shared/MediaKey";
import { ProdSync } from "../prod.ts";

const markerInvalidationMediaKeys = (
  previousMediaKey: string,
  updatedMediaKey: string,
): ReadonlyArray<string> => {
  const directories = new Set<string>();
  const mediaKeys: Array<string> = [];
  for (const mediaKey of [previousMediaKey, updatedMediaKey]) {
    const directory = r2KeyDir(mediaKey);
    if (mediaKey === "" || directory === "" || directories.has(directory)) continue;
    directories.add(directory);
    mediaKeys.push(mediaKey);
  }
  return mediaKeys;
};

/** Records regenerated media before invalidating its publication markers so retries use matching metadata. */
export class MediaReplacement extends Context.Service<
  MediaReplacement,
  {
    readonly replace: (
      previous: Asset,
      updated: Asset,
    ) => Effect.Effect<
      Asset,
      PersistenceError | SlugAlreadyExistsError | InvalidMediaShapeError | ProdSyncError
    >;
  }
>()("admin/MediaReplacement") {
  static readonly layer = Layer.effect(
    MediaReplacement,
    Effect.gen(function* () {
      const assets = yield* AssetRepository;
      const prod = yield* ProdSync;
      return MediaReplacement.of({
        replace: (previous, updated) =>
          Effect.gen(function* () {
            const replaced = yield* assets.replaceMedia(updated);
            const [invalidationFailures] = yield* Effect.partition(
              markerInvalidationMediaKeys(previous.mediaKey, updated.mediaKey),
              prod.invalidateMedia,
              { concurrency: 1 },
            );
            const invalidationFailure = invalidationFailures.at(0);
            if (invalidationFailure !== undefined) return yield* invalidationFailure;
            return replaced;
          }),
      });
    }),
  );
}

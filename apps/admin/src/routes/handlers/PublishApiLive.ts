import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { Asset, AssetId } from "@videoshare/shared/Asset";
import { AssetNotFoundError } from "@videoshare/shared/AssetErrors";
import { Storage } from "../../services/Storage.ts";
import { ProdSync } from "../../prod.ts";
import { NotTranscodedError } from "../../errors/UploadErrors.ts";
import { AdminApi } from "../AdminApi.ts";

export const PublishApiLive = HttpApiBuilder.group(AdminApi, "publish", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepository;
    const prod = yield* ProdSync;
    const storage = yield* Storage;

    return handlers
      .handle("publish", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* repo.findById(AssetId.make(params.id));
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: params.id });
          }
          if (!found.value.mediaKey) {
            return yield* new NotTranscodedError({ assetId: found.value.id });
          }

          const chapters = yield* repo.listChapters(found.value.id);
          const publishedAsset = new Asset({
            ...found.value,
            publishedAt: Date.now(),
          });

          const hasMedia = yield* prod.mediaExists(publishedAsset.id);
          if (!hasMedia) {
            yield* prod.uploadMedia(publishedAsset.id, storage.videoDir(publishedAsset.id));
          }
          yield* prod.syncMetadata(publishedAsset, chapters);

          return yield* repo.update(publishedAsset);
        }),
      )
      .handle("unpublish", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* repo.findById(AssetId.make(params.id));
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: params.id });
          }
          yield* prod.removeMedia(found.value.id);
          yield* prod.unpublish(found.value.id);
          const unpublished = new Asset({ ...found.value, publishedAt: null });
          return yield* repo.update(unpublished);
        }),
      );
  }),
);

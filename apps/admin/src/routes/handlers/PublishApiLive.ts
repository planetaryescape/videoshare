import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Asset, AssetId } from "@videoshare/shared/Asset";
import { AssetNotFoundError } from "@videoshare/shared/AssetErrors";
import { ProdSync, Publisher } from "../../prod.ts";
import { NotTranscodedError } from "../../errors/UploadErrors.ts";
import { AdminApi } from "../AdminApi.ts";
import {
  assertDirectAssetMutationAllowed,
  PublicationGate,
} from "../../services/PublicationGate.ts";

export const PublishApiLive = HttpApiBuilder.group(AdminApi, "publish", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepository;
    const projects = yield* ProjectRepository;
    const prod = yield* ProdSync;
    const publisher = yield* Publisher;
    const gate = yield* PublicationGate;

    return handlers
      .handle("publish", ({ params }) =>
        gate.serialize(
          Effect.gen(function* () {
            const found = yield* repo.findById(AssetId.make(params.id));
            if (Option.isNone(found)) {
              return yield* new AssetNotFoundError({ id: params.id });
            }
            if (!found.value.mediaKey)
              return yield* new NotTranscodedError({ assetId: found.value.id });
            yield* assertDirectAssetMutationAllowed(found.value, "publish", projects);
            return yield* publisher.publishAsset(found.value.id);
          }),
        ),
      )
      .handle("unpublish", ({ params }) =>
        gate.serialize(
          Effect.gen(function* () {
            const found = yield* repo.findById(AssetId.make(params.id));
            if (Option.isNone(found)) {
              return yield* new AssetNotFoundError({ id: params.id });
            }
            yield* assertDirectAssetMutationAllowed(found.value, "unpublish", projects);
            yield* prod.removeMedia(found.value.mediaKey);
            yield* prod.unpublish(found.value.id);
            const unpublished = new Asset({ ...found.value, publishedAt: null });
            return yield* repo.update(unpublished);
          }),
        ),
      );
  }),
);

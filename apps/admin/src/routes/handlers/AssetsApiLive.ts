import { HttpApiBuilder } from "effect/unstable/httpapi";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { Asset, AssetId } from "@videoshare/shared/Asset";
import { AssetNotFoundError } from "@videoshare/shared/AssetErrors";
import { generateSlug } from "@videoshare/shared/Slug";
import { Effect, Option } from "effect";
import { Storage } from "../../services/Storage.ts";
import { chaptersFromInput } from "../../schemas/Chapters.ts";
import { ProdSync } from "../../prod.ts";
import { AdminApi } from "../AdminApi.ts";

export const AssetsApiLive = HttpApiBuilder.group(AdminApi, "assets", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepository;
    const storage = yield* Storage;
    const prod = yield* ProdSync;

    return handlers
      .handle("listAssets", () => repo.list())
      .handle("getAsset", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* repo.findById(AssetId.make(params.id));
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: params.id });
          }
          const chapters = yield* repo.listChapters(found.value.id);
          return { video: found.value, chapters };
        }),
      )
      .handle("createAsset", ({ payload }) =>
        Effect.gen(function* () {
          const video = new Asset({
            id: AssetId.make(crypto.randomUUID()),
            slug: generateSlug(),
            kind: "video",
            title: payload.title,
            description: payload.description ?? null,
            posterKey: null,
            mediaKey: "",
            durationSec: 0,
            passwordHash: null,
            createdAt: Date.now(),
            publishedAt: null,
            updatedAt: null,
          });
          return yield* repo.create(video);
        }),
      )
      .handle("updateAsset", ({ params, payload }) =>
        Effect.gen(function* () {
          const found = yield* repo.findById(AssetId.make(params.id));
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: params.id });
          }
          const updated = new Asset({
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
      .handle("deleteAsset", ({ params }) =>
        Effect.gen(function* () {
          const id = AssetId.make(params.id);
          const found = yield* repo.findById(id);
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: params.id });
          }
          yield* prod.removeFromProd(params.id);
          yield* storage.removeAssetDir(params.id);
          yield* repo.delete(id);
          return { success: true };
        }),
      );
  }),
);

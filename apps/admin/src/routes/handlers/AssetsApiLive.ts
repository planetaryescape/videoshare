import { HttpApiBuilder } from "effect/unstable/httpapi";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Asset, AssetId } from "@videoshare/shared/Asset";
import { AssetNotFoundError, ImageChaptersNotAllowedError } from "@videoshare/shared/AssetErrors";
import { generateSlug } from "@videoshare/shared/Slug";
import { Effect, Option } from "effect";
import { Storage } from "../../services/Storage.ts";
import { chaptersFromInput } from "../../schemas/Chapters.ts";
import { ProdSync } from "../../prod.ts";
import {
  assertDirectAssetMutationAllowed,
  PublicationGate,
} from "../../services/PublicationGate.ts";
import { AdminApi } from "../AdminApi.ts";

export const AssetsApiLive = HttpApiBuilder.group(AdminApi, "assets", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepository;
    const projects = yield* ProjectRepository;
    const storage = yield* Storage;
    const prod = yield* ProdSync;
    const gate = yield* PublicationGate;

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
        gate.serialize(
          Effect.gen(function* () {
            const asset = new Asset({
              id: AssetId.make(crypto.randomUUID()),
              slug: generateSlug(),
              kind: "video",
              title: payload.title,
              description: payload.description ?? null,
              posterKey: null,
              mediaKey: "",
              durationSec: 0,
              width: null,
              height: null,
              passwordHash: null,
              projectId: null,
              sortOrder: null,
              createdAt: Date.now(),
              publishedAt: null,
              updatedAt: null,
            });
            return yield* repo.create(asset);
          }),
        ),
      )
      .handle("updateAsset", ({ params, payload }) =>
        gate.serialize(
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
            if (updated.kind === "image" && (payload.chapters?.length ?? 0) > 0)
              return yield* new ImageChaptersNotAllowedError({
                assetId: updated.id,
                chapterCount: payload.chapters?.length ?? 0,
              });
            const asset = yield* repo.update(updated);

            if (payload.chapters !== undefined) {
              yield* repo.replaceChapters(asset.id, chaptersFromInput(asset.id, payload.chapters));
            }

            const chapters = yield* repo.listChapters(asset.id);
            return { video: asset, chapters };
          }),
        ),
      )
      .handle("deleteAsset", ({ params }) =>
        gate.serialize(
          Effect.gen(function* () {
            const id = AssetId.make(params.id);
            const found = yield* repo.findById(id);
            if (Option.isNone(found)) {
              return yield* new AssetNotFoundError({ id: params.id });
            }
            yield* assertDirectAssetMutationAllowed(found.value, "delete", projects);
            yield* prod.removeFromProd(params.id, found.value.mediaKey);
            yield* storage.removeAssetDir(params.id);
            yield* repo.delete(id, Date.now());
            return { success: true };
          }),
        ),
      );
  }),
);

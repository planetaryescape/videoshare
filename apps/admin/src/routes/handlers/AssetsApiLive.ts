import { HttpApiBuilder } from "effect/unstable/httpapi";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Asset, AssetId, isTimedKind } from "@videoshare/shared/Asset";
import {
  AssetKindMismatchError,
  AssetNotFoundError,
  ImageChaptersNotAllowedError,
} from "@videoshare/shared/AssetErrors";
import { generateSlug } from "@videoshare/shared/Slug";
import { Effect, Option } from "effect";
import { Storage } from "../../services/Storage.ts";
import { MediaReplacement } from "../../services/MediaReplacement.ts";
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
    const replacement = yield* MediaReplacement;

    return handlers
      .handle("listAssets", () => repo.list())
      .handle("getAsset", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* repo.findById(AssetId.make(params.id));
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: params.id });
          }
          const chapters = yield* repo.listChapters(found.value.id);
          if (found.value.kind !== "markdown") {
            return { video: found.value, chapters };
          }
          const exists = yield* storage.exists(`${found.value.id}/content.md`);
          const body = exists
            ? new TextDecoder().decode(yield* storage.readFile(`${found.value.id}/content.md`))
            : "";
          return { video: { ...found.value, body }, chapters };
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
            if (!isTimedKind(updated.kind) && (payload.chapters?.length ?? 0) > 0)
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
      )
      .handle("updateAssetContent", ({ params, payload }) =>
        gate.serialize(
          Effect.gen(function* () {
            const found = yield* repo.findById(AssetId.make(params.id));
            if (Option.isNone(found)) {
              return yield* new AssetNotFoundError({ id: params.id });
            }
            if (found.value.kind !== "markdown") {
              return yield* new AssetKindMismatchError({
                assetId: found.value.id,
                expectedKind: "markdown",
                actualKind: found.value.kind,
              });
            }
            yield* assertDirectAssetMutationAllowed(found.value, "content", projects);
            yield* storage.ensureAssetDir(found.value.id);
            yield* storage.writeFile(
              `${found.value.id}/content.md`,
              new TextEncoder().encode(payload.body),
            );
            const updated = new Asset({ ...found.value, updatedAt: Date.now() });
            return yield* replacement.replace(found.value, updated);
          }),
        ),
      );
  }),
);

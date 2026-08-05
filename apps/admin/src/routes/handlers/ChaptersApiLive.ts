import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { AssetId } from "@videoshare/shared/Asset";
import { AssetNotFoundError } from "@videoshare/shared/AssetErrors";
import { chaptersFromInput } from "../../schemas/Chapters.ts";
import { AdminApi } from "../AdminApi.ts";
import { PublicationGate } from "../../services/PublicationGate.ts";

export const ChaptersApiLive = HttpApiBuilder.group(AdminApi, "chapters", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepository;
    const gate = yield* PublicationGate;

    return handlers.handle("replaceChapters", ({ params, payload }) =>
      gate.serialize(
        Effect.gen(function* () {
          const found = yield* repo.findById(AssetId.make(params.assetId));
          if (Option.isNone(found)) {
            return yield* new AssetNotFoundError({ id: params.assetId });
          }
          const chapters = chaptersFromInput(AssetId.make(params.assetId), payload);
          yield* repo.replaceChapters(found.value.id, chapters);
          return chapters;
        }),
      ),
    );
  }),
);

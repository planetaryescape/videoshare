import { SqliteClient } from "@effect/sql-sqlite-bun";
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option, Result } from "effect";
import { Asset, AssetId, Slug } from "@videoshare/shared/Asset";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProdSyncError } from "@videoshare/shared/AssetErrors";
import { migrate } from "@videoshare/shared/Migrations";
import { ProdSync } from "../prod.ts";
import { MediaReplacement } from "./MediaReplacement.ts";

const asset = (mediaKey: string) =>
  new Asset({
    id: AssetId.make("asset-1"),
    slug: Slug.make("asset-1"),
    kind: "image",
    title: "Asset",
    description: null,
    posterKey: null,
    mediaKey,
    durationSec: 0,
    width: 40,
    height: 30,
    passwordHash: null,
    projectId: null,
    sortOrder: null,
    createdAt: 1,
    publishedAt: null,
    updatedAt: 1,
  });

class MarkerStore {
  readonly invalidated: Array<string> = [];

  private readonly failedMediaKey: string | undefined;

  constructor(failedMediaKey?: string) {
    this.failedMediaKey = failedMediaKey;
  }

  readonly service = ProdSync.of({
    replaceProjectCatalog: () => Effect.void,
    removeProject: () => Effect.void,
    uploadMedia: () => Effect.void,
    invalidateMedia: (mediaKey) => {
      this.invalidated.push(mediaKey);
      return mediaKey === this.failedMediaKey
        ? Effect.fail(new ProdSyncError({ operation: "invalidate", cause: "failed" }))
        : Effect.void;
    },
    mediaExists: () => Effect.succeed(false),
    syncMetadata: () => Effect.void,
    pushToProd: () => Effect.void,
    removeMedia: () => Effect.void,
    unpublish: () => Effect.void,
    removeFromProd: () => Effect.void,
  });
}

describe("MediaReplacement", () => {
  test("invalidates every affected marker before retaining existing media metadata on failure", async () => {
    const sql = SqliteClient.layer({ filename: ":memory:" });
    const markers = new MarkerStore("media/asset-1/original.png");
    const repositories = AssetRepository.layerNoDeps.pipe(Layer.provide(sql));
    const prod = Layer.succeed(ProdSync, markers.service);
    const replacement = MediaReplacement.layer.pipe(
      Layer.provideMerge(Layer.merge(repositories, prod)),
    );
    const layer = Layer.mergeAll(sql, repositories, prod, replacement);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const assets = yield* AssetRepository;
        const mediaReplacement = yield* MediaReplacement;
        const previous = asset("legacy/asset-1/master.m3u8");
        const updated = asset("media/asset-1/original.png");
        yield* migrate;
        yield* assets.create(previous);
        const replace = yield* Effect.result(mediaReplacement.replace(previous, updated));
        const persisted = yield* assets.findById(previous.id);
        return { replace, persisted };
      }).pipe(Effect.provide(layer)),
    );

    expect(markers.invalidated).toEqual([
      "legacy/asset-1/master.m3u8",
      "media/asset-1/original.png",
    ]);
    expect(Result.isFailure(result.replace)).toBe(true);
    expect(Option.getOrThrow(result.persisted).mediaKey).toBe("legacy/asset-1/master.m3u8");
  });

  test("deduplicates media keys that share one directory", async () => {
    const sql = SqliteClient.layer({ filename: ":memory:" });
    const markers = new MarkerStore();
    const repositories = AssetRepository.layerNoDeps.pipe(Layer.provide(sql));
    const prod = Layer.succeed(ProdSync, markers.service);
    const replacement = MediaReplacement.layer.pipe(
      Layer.provideMerge(Layer.merge(repositories, prod)),
    );
    const layer = Layer.mergeAll(sql, repositories, prod, replacement);
    await Effect.runPromise(
      Effect.gen(function* () {
        const assets = yield* AssetRepository;
        const mediaReplacement = yield* MediaReplacement;
        const previous = asset("media/asset-1/master.m3u8");
        const updated = asset("media/asset-1/original.png");
        yield* migrate;
        yield* assets.create(previous);
        yield* mediaReplacement.replace(previous, updated);
      }).pipe(Effect.provide(layer)),
    );

    expect(markers.invalidated).toEqual(["media/asset-1/master.m3u8"]);
  });
});

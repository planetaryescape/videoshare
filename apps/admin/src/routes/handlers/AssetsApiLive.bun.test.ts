import { randomUUID } from "node:crypto";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { Asset, AssetId, ProjectId, Slug } from "@videoshare/shared/Asset";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Project } from "@videoshare/shared/Project";
import { migrate } from "@videoshare/shared/Migrations";
import { AdminApi } from "../AdminApi.ts";
import { AssetsApiLive } from "./AssetsApiLive.ts";
import { Storage } from "../../services/Storage.ts";
import { ProdSync } from "../../prod.ts";
import { PublicationGate } from "../../services/PublicationGate.ts";
import { MediaReplacement } from "../../services/MediaReplacement.ts";

const platformLayer = Layer.merge(
  HttpServer.layerServices,
  Layer.merge(NodeFileSystem.layer, NodePath.layer),
);
const storageLayer = Storage.layer.pipe(Layer.provide(platformLayer));
const dbFilename = `${import.meta.dir}/AssetsApiLive.${randomUUID()}.test.db`;
const sqlLayer = SqliteClient.layer({ filename: dbFilename });
const repositoriesLayer = Layer.mergeAll(
  AssetRepository.layerNoDeps,
  ProjectRepository.layerNoDeps,
).pipe(Layer.provide(sqlLayer));
const fakeProdSync = Layer.succeed(
  ProdSync,
  ProdSync.of({
    replaceProjectCatalog: () => Effect.void,
    removeProject: () => Effect.void,
    uploadMedia: () => Effect.void,
    invalidateMedia: () => Effect.void,
    mediaExists: () => Effect.succeed(false),
    syncMetadata: () => Effect.void,
    pushToProd: () => Effect.void,
    removeMedia: () => Effect.void,
    unpublish: () => Effect.void,
    removeFromProd: () => Effect.void,
  }),
);
const mediaReplacementLayer = MediaReplacement.layer.pipe(
  Layer.provideMerge(Layer.merge(fakeProdSync, repositoriesLayer)),
);
const dependencies = Layer.mergeAll(
  storageLayer,
  repositoriesLayer,
  fakeProdSync,
  PublicationGate.layer,
  mediaReplacementLayer,
);

const readField = (payload: unknown, field: string): string => {
  if (typeof payload !== "object" || payload === null || !(field in payload)) {
    throw new Error(`response payload has no ${field}`);
  }
  const value = Reflect.get(payload, field);
  if (typeof value !== "string") throw new Error(`response ${field} is not a string`);
  return value;
};

const notImplemented = Effect.die("not implemented in this test");

const stubProjects = HttpApiBuilder.group(AdminApi, "projects", (handlers) =>
  handlers
    .handle("listProjects", () => notImplemented)
    .handle("getProject", () => notImplemented)
    .handle("createProject", () => notImplemented)
    .handle("updateProject", () => notImplemented)
    .handle("replaceMembers", () => notImplemented)
    .handle("moveMember", () => notImplemented)
    .handle("unfileMember", () => notImplemented)
    .handle("publishProject", () => notImplemented)
    .handle("unpublishProject", () => notImplemented)
    .handle("deleteProject", () => notImplemented),
);

const stubUpload = HttpApiBuilder.group(AdminApi, "upload", (handlers) =>
  handlers.handleRaw("upload", () => notImplemented),
);

const stubPublish = HttpApiBuilder.group(AdminApi, "publish", (handlers) =>
  handlers.handle("publish", () => notImplemented).handle("unpublish", () => notImplemented),
);

const unusedGroupsLayer = Layer.mergeAll(stubProjects, stubUpload, stubPublish);

const appLayer = HttpApiBuilder.layer(AdminApi).pipe(
  Layer.provide(Layer.mergeAll(AssetsApiLive, unusedGroupsLayer)),
  Layer.provide(dependencies),
  Layer.provide(platformLayer),
);

const request = (assetId: string, body: string) =>
  new Request(`http://local/api/assets/${assetId}/content`, {
    method: "PUT",
    body: JSON.stringify({ body }),
    headers: { "content-type": "application/json" },
  });

const markdownAsset = (id: string) =>
  new Asset({
    id: AssetId.make(id),
    slug: Slug.make(id),
    kind: "markdown",
    title: id,
    description: null,
    posterKey: null,
    mediaKey: `media/${id}/content.md`,
    durationSec: 0,
    width: null,
    height: null,
    passwordHash: null,
    projectId: null,
    sortOrder: null,
    createdAt: 1,
    publishedAt: null,
    updatedAt: null,
  });

const videoAsset = (id: string) =>
  new Asset({
    id: AssetId.make(id),
    slug: Slug.make(id),
    kind: "video",
    title: id,
    description: null,
    posterKey: null,
    mediaKey: `media/${id}/master.m3u8`,
    durationSec: 10,
    width: null,
    height: null,
    passwordHash: null,
    projectId: null,
    sortOrder: null,
    createdAt: 1,
    publishedAt: null,
    updatedAt: null,
  });

const project = (id: string, publishedAt: number | null) =>
  new Project({
    id: ProjectId.make(id),
    slug: Slug.make(id),
    title: id,
    description: null,
    passwordHash: null,
    createdAt: 1,
    publishedAt,
    updatedAt: null,
  });

const assetIds = ["content-happy", "content-wrong-kind", "content-locked", "content-missing"];

afterEach(async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* Storage;
      yield* Effect.all(assetIds.map((assetId) => storage.removeAssetDir(assetId)));
    }).pipe(Effect.provide(storageLayer)),
  );
});

afterAll(async () => {
  await Bun.file(dbFilename)
    .delete()
    .catch(() => undefined);
});

describe("PUT /api/assets/:id/content", () => {
  test("writes content.md and returns the updated asset", async () => {
    const { handler } = HttpRouter.toWebHandler(appLayer);
    await Effect.runPromise(
      Effect.gen(function* () {
        const assets = yield* AssetRepository;
        yield* migrate;
        yield* assets.create(markdownAsset("content-happy"));
      }).pipe(Effect.provide(Layer.mergeAll(sqlLayer, repositoriesLayer))),
    );

    const response = await handler(request("content-happy", "# Hello world"));
    expect(response.status).toBe(200);
    expect(readField(await response.json(), "kind")).toBe("markdown");

    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* Storage;
        return new TextDecoder().decode(yield* storage.readFile("content-happy/content.md"));
      }).pipe(Effect.provide(storageLayer)),
    );
    expect(stored).toBe("# Hello world");
  });

  test("rejects non-markdown assets", async () => {
    const { handler } = HttpRouter.toWebHandler(appLayer);
    await Effect.runPromise(
      Effect.gen(function* () {
        const assets = yield* AssetRepository;
        yield* migrate;
        yield* assets.create(videoAsset("content-wrong-kind"));
      }).pipe(Effect.provide(Layer.mergeAll(sqlLayer, repositoriesLayer))),
    );

    const response = await handler(request("content-wrong-kind", "# Hello"));
    expect(response.status).toBe(422);
    expect(readField(await response.json(), "_tag")).toBe("AssetKindMismatchError");
  });

  test("returns 404 for a missing asset", async () => {
    const { handler } = HttpRouter.toWebHandler(appLayer);
    await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)));

    const response = await handler(request("content-missing", "# Hello"));
    expect(response.status).toBe(404);
  });

  test("locks published-project members", async () => {
    const { handler } = HttpRouter.toWebHandler(appLayer);
    await Effect.runPromise(
      Effect.gen(function* () {
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* migrate;
        const published = project("content-locked-project", 10);
        const member = markdownAsset("content-locked");
        yield* projects.create(published);
        yield* assets.create(member);
        yield* projects.move(member.id, published.id, 2);
        const aggregate = Option.getOrThrow(yield* projects.get(published.id));
        yield* projects.markPublished([aggregate], 10);
      }).pipe(Effect.provide(Layer.mergeAll(sqlLayer, repositoriesLayer))),
    );

    const response = await handler(request("content-locked", "# Hello"));
    expect(response.status).toBe(409);
    expect(readField(await response.json(), "_tag")).toBe("PublishedProjectMemberMutationError");
  });
});

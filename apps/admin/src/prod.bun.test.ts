import { SqliteClient } from "@effect/sql-sqlite-bun";
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option, Result } from "effect";
import { Asset, AssetId, Chapter, ChapterId, ProjectId, Slug } from "@videoshare/shared/Asset";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { migrate } from "@videoshare/shared/Migrations";
import { Project, ProjectAggregate } from "@videoshare/shared/Project";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { ProdSyncError } from "@videoshare/shared/AssetErrors";
import {
  chapterReplacementStatements,
  d1BatchRequest,
  isSuccessfulD1BatchResponse,
  mediaCompletionMarkerForMediaKey,
  mediaCompletionMarkerKey,
  projectSnapshotStatements,
  ProdSync,
  Publisher,
  type ProjectCatalogSnapshot,
} from "./prod.ts";
import { Storage } from "./services/Storage.ts";

const asset = (id: string, projectId: ProjectId | null = null) =>
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
    projectId,
    sortOrder: projectId === null ? null : 0,
    createdAt: 1,
    publishedAt: null,
    updatedAt: 2,
  });
const project = (
  id: string,
  publishedAt: number | null = null,
  passwordHash: string | null = null,
) =>
  new Project({
    id: ProjectId.make(id),
    slug: Slug.make(id),
    title: id,
    description: null,
    passwordHash,
    createdAt: 1,
    publishedAt,
    updatedAt: 2,
  });

test("derives one completion marker under each asset media prefix", () => {
  expect(mediaCompletionMarkerKey("asset-1")).toBe("media/asset-1/.complete");
  expect(mediaCompletionMarkerForMediaKey("media/asset-1/master.m3u8")).toBe(
    "media/asset-1/.complete",
  );
  expect(mediaCompletionMarkerForMediaKey("media/asset-1/image.png")).toBe(
    "media/asset-1/.complete",
  );
  expect(mediaCompletionMarkerForMediaKey("assets/legacy/master.m3u8")).toBe(
    "assets/legacy/.complete",
  );
});

describe("D1 batch REST adapter shapes", () => {
  test("uses the documented batch envelope", () => {
    expect(d1BatchRequest([{ sql: "SELECT ?", params: [1] }])).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batch: [{ sql: "SELECT ?", params: [1] }] }),
    });
  });

  test("accepts one successful envelope and rejects failed or legacy response shapes", () => {
    expect(
      isSuccessfulD1BatchResponse({ success: true, errors: [], result: [{ success: true }] }, [
        { sql: "SELECT 1", params: [] },
      ]),
    ).toBe(true);
    expect(
      isSuccessfulD1BatchResponse(
        { success: true, result: [{ success: false, errors: [{ message: "no" }] }] },
        [{ sql: "SELECT 1", params: [] }],
      ),
    ).toBe(false);
    expect(
      isSuccessfulD1BatchResponse([{ success: true }], [{ sql: "SELECT 1", params: [] }]),
    ).toBe(false);
    expect(
      isSuccessfulD1BatchResponse({ success: true, result: [] }, [{ sql: "SELECT 1", params: [] }]),
    ).toBe(false);
    expect(
      isSuccessfulD1BatchResponse({ success: true, result: [{ success: true }] }, [
        { sql: "SELECT 1", params: [] },
        { sql: "SELECT 2", params: [] },
      ]),
    ).toBe(false);
  });
});

test("replaces direct chapters with one bound D1 batch", () => {
  const statements = chapterReplacementStatements("target", [
    new Chapter({
      id: ChapterId.make("chapter"),
      assetId: AssetId.make("other"),
      title: "Start",
      startSec: 0,
      sortOrder: 0,
    }),
  ]);

  expect(statements).toEqual([
    { sql: "DELETE FROM chapters WHERE asset_id = ?", params: ["target"] },
    {
      sql: "INSERT INTO chapters (id, asset_id, title, start_sec, sort_order) VALUES (?, ?, ?, ?, ?)",
      params: ["chapter", "target", "Start", 0, 0],
    },
  ]);
});

test("project snapshot statements fully replace membership in deterministic order without deleting direct rows", () => {
  const alpha = project("alpha");
  const beta = project("beta");
  const alphaAsset = asset("alpha-asset", alpha.id);
  const betaAsset = asset("beta-asset", beta.id);
  const chapter = new Chapter({
    id: ChapterId.make("chapter-1"),
    assetId: alphaAsset.id,
    title: "Start",
    startSec: 0,
    sortOrder: 0,
  });
  const statements = projectSnapshotStatements(
    [
      new ProjectAggregate({ project: alpha, assets: [alphaAsset] }),
      new ProjectAggregate({ project: beta, assets: [betaAsset] }),
    ],
    new Map([[String(alphaAsset.id), [chapter]]]),
    99,
  );
  expect(statements.map((statement) => statement.sql)).toEqual([
    "UPDATE assets SET project_id = NULL, sort_order = NULL",
    "DELETE FROM projects",
    expect.stringContaining("INSERT INTO projects"),
    expect.stringContaining("INSERT INTO assets"),
    "DELETE FROM chapters WHERE asset_id = ?",
    "INSERT INTO chapters (id, asset_id, title, start_sec, sort_order) VALUES (?, ?, ?, ?, ?)",
    expect.stringContaining("INSERT INTO projects"),
    expect.stringContaining("INSERT INTO assets"),
    "DELETE FROM chapters WHERE asset_id = ?",
  ]);
  expect(statements[3]?.params.slice(11, 15)).toEqual([alpha.id, 0, 1, 99]);
  expect(statements[7]?.params.slice(11, 15)).toEqual([beta.id, 0, 1, 99]);
  expect(statements.some((statement) => statement.sql.startsWith("DELETE FROM assets"))).toBe(
    false,
  );
});

class RecordingProdSync {
  readonly events: Array<string> = [];
  readonly snapshots: Array<ProjectCatalogSnapshot> = [];
  failCatalog = false;
  readonly completeMedia = new Set<string>();
  readonly service = ProdSync.of({
    replaceProjectCatalog: (snapshot) => {
      this.events.push("catalog");
      this.snapshots.push(snapshot);
      return this.failCatalog
        ? Effect.fail(new ProdSyncError({ operation: "catalog", cause: "failed" }))
        : Effect.void;
    },
    removeProject: (id) => {
      this.events.push(`remove-project:${id}`);
      return Effect.void;
    },
    mediaExists: (key) => {
      this.events.push(`exists:${key}`);
      return Effect.succeed(this.completeMedia.has(key));
    },
    uploadMedia: (mediaKey) => {
      this.events.push(`upload:${mediaKey}`);
      this.completeMedia.add(mediaKey);
      return Effect.void;
    },
    invalidateMedia: () => Effect.void,
    syncMetadata: () => Effect.void,
    pushToProd: () => Effect.void,
    removeMedia: () => Effect.void,
    unpublish: () => Effect.void,
    removeFromProd: () => Effect.void,
  });
}

const storage = Layer.succeed(
  Storage,
  Storage.of({
    rootDir: "/tmp",
    assetDir: (id) => `/tmp/${id}`,
    mediaPath: (path) => path,
    ensureAssetDir: () => Effect.void,
    resetAssetDir: () => Effect.void,
    removeAssetDir: () => Effect.void,
    exists: () => Effect.succeed(false),
    readFile: () => Effect.succeed(new Uint8Array()),
    writeFile: () => Effect.void,
    serveFile: () =>
      Effect.succeed({ body: new Uint8Array(), contentType: "application/octet-stream" }),
  }),
);

const publishFixture = async ({
  failCatalog = false,
  unpublishAfterPublish = false,
  externalMediaKey = null,
  targetPasswordHash = null,
}: {
  readonly failCatalog?: boolean;
  readonly unpublishAfterPublish?: boolean;
  readonly externalMediaKey?: string | null;
  readonly targetPasswordHash?: string | null;
} = {}) => {
  const sql = SqliteClient.layer({ filename: ":memory:" });
  const recording = new RecordingProdSync();
  recording.failCatalog = failCatalog;
  const prod = Layer.succeed(ProdSync, recording.service);
  const repositories = Layer.mergeAll(
    AssetRepository.layerNoDeps,
    ProjectRepository.layerNoDeps,
  ).pipe(Layer.provide(sql));
  const publisher = Publisher.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(repositories, storage, prod)),
  );
  const layer = Layer.mergeAll(sql, repositories, storage, prod, publisher);
  return Effect.runPromise(
    Effect.gen(function* () {
      const assets = yield* AssetRepository;
      const projects = yield* ProjectRepository;
      const publish = yield* Publisher;
      yield* migrate;
      const target = project("target", null, targetPasswordHash);
      const alreadyPublished = project("published", 4);
      yield* projects.create(target);
      yield* projects.create(alreadyPublished);
      const targetAsset = new Asset({
        ...asset("target-asset"),
        mediaKey: externalMediaKey ?? "media/target-asset/master.m3u8",
      });
      const publishedAsset = asset("published-asset");
      yield* assets.create(targetAsset);
      yield* assets.create(publishedAsset);
      yield* projects.move(targetAsset.id, target.id, 3);
      yield* projects.move(publishedAsset.id, alreadyPublished.id, 3);
      const first = yield* Effect.result(publish.publishProject(target.id));
      if (unpublishAfterPublish && !failCatalog) yield* publish.unpublishProject(target.id);
      const second =
        failCatalog || unpublishAfterPublish
          ? undefined
          : yield* Effect.result(publish.publishProject(target.id));
      const targetAfter = yield* projects.get(target.id);
      const assetAfter = yield* assets.findById(targetAsset.id);
      return { first, second, targetAfter, assetAfter, target, recording };
    }).pipe(Effect.provide(layer)),
  );
};

describe("Publisher project publication", () => {
  test("reuploads a prefix without a completion marker before recording the complete target-plus-published snapshot", async () => {
    const result = await publishFixture();
    expect(Result.isSuccess(result.first)).toBe(true);
    expect(result.recording.events.slice(0, 5)).toEqual([
      "exists:media/target-asset/master.m3u8",
      "upload:media/target-asset/master.m3u8",
      "exists:media/published-asset/master.m3u8",
      "upload:media/published-asset/master.m3u8",
      "catalog",
    ]);
    expect(result.second === undefined ? false : Result.isSuccess(result.second)).toBe(true);
    expect(
      result.recording.snapshots[0]?.projects.map((aggregate) => String(aggregate.project.id)),
    ).toEqual(["target", "published"]);
    expect(
      result.recording.snapshots.map((snapshot) =>
        snapshot.projects.map((aggregate) => String(aggregate.project.id)),
      ),
    ).toEqual([
      ["target", "published"],
      ["target", "published"],
    ]);
    expect(Option.getOrNull(result.targetAfter)?.project.publishedAt).not.toBeNull();
    expect(Option.getOrNull(result.assetAfter)?.publishedAt).not.toBeNull();
  });

  test("unpublishing removes the remote project but retains local members and direct asset publication", async () => {
    const result = await publishFixture({ unpublishAfterPublish: true });

    expect(result.recording.events).toContain("remove-project:target");
    expect(Option.getOrThrow(result.targetAfter).project.publishedAt).toBeNull();
    expect(Option.getOrThrow(result.targetAfter).assets).toHaveLength(1);
    expect(Option.getOrThrow(result.assetAfter)).toMatchObject({
      projectId: "target",
      publishedAt: expect.any(Number),
    });
  });

  test("remote failure leaves local publication timestamps unchanged", async () => {
    const result = await publishFixture({ failCatalog: true });
    expect(Result.isFailure(result.first)).toBe(true);
    expect(Option.getOrNull(result.targetAfter)?.project.publishedAt).toBeNull();
    expect(Option.getOrNull(result.assetAfter)?.publishedAt).toBeNull();
  });

  test("rejects an absolute media key in a password-protected project", async () => {
    const result = await publishFixture({
      externalMediaKey: "https://cdn.example/video.m3u8",
      targetPasswordHash: "hash",
    });

    expect(Result.isFailure(result.first)).toBe(true);
    if (Result.isFailure(result.first))
      expect(result.first.failure).toMatchObject({
        _tag: "ProjectPublicationValidationError",
        projectId: "target",
        reason: "absoluteMediaKeyInProtectedProject",
      });
    expect(result.recording.events).not.toContain("catalog");
  });

  test("publishes a passwordless project with an absolute media key without R2 synchronization", async () => {
    const result = await publishFixture({ externalMediaKey: "https://cdn.example/video.m3u8" });

    expect(Result.isSuccess(result.first)).toBe(true);
    expect(result.recording.events).toContain("catalog");
    expect(result.recording.events).not.toContain("exists:https://cdn.example/video.m3u8");
    expect(result.recording.events).not.toContain("upload:https://cdn.example/video.m3u8");
  });
});

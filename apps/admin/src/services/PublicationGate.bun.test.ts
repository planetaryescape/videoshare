import { SqliteClient } from "@effect/sql-sqlite-bun";
import { expect, test } from "bun:test";
import { Asset, AssetId, ProjectId, Slug } from "@videoshare/shared/Asset";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { migrate } from "@videoshare/shared/Migrations";
import { Project } from "@videoshare/shared/Project";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Effect, Layer, Option, Result } from "effect";
import { assertDirectAssetMutationAllowed, PublicationGate } from "./PublicationGate.ts";

test("serializes concurrent work and releases the permit after failure", async () => {
  let active = 0;
  let peak = 0;
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* PublicationGate;
      const work = gate.serialize(
        Effect.gen(function* () {
          active += 1;
          peak = Math.max(peak, active);
          yield* Effect.sleep("10 millis");
          active -= 1;
        }),
      );
      yield* Effect.all([work, work], { concurrency: "unbounded" });
      const failed = yield* Effect.result(gate.serialize(Effect.fail("failed")));
      yield* gate.serialize(Effect.void);
      return failed;
    }).pipe(Effect.provide(PublicationGate.layer)),
  );

  expect(peak).toBe(1);
  expect(Result.isFailure(result)).toBe(true);
});

const asset = (id: string) =>
  new Asset({
    id: AssetId.make(id),
    slug: Slug.make(id),
    kind: "video",
    title: id,
    description: null,
    posterKey: null,
    mediaKey: `media/${id}/master.m3u8`,
    durationSec: 1,
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

test("blocks direct unpublish and delete only for members of locally published projects", async () => {
  const sql = SqliteClient.layer({ filename: ":memory:" });
  const repositories = Layer.mergeAll(
    AssetRepository.layerNoDeps,
    ProjectRepository.layerNoDeps,
  ).pipe(Layer.provide(sql));
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const assets = yield* AssetRepository;
      const projects = yield* ProjectRepository;
      yield* migrate;

      const published = project("published", 10);
      const draft = project("draft", null);
      const publishedMember = asset("published-member");
      const draftMember = asset("draft-member");
      const unfiled = asset("unfiled");
      yield* projects.create(published);
      yield* projects.create(draft);
      yield* assets.create(publishedMember);
      yield* assets.create(draftMember);
      yield* assets.create(unfiled);
      yield* projects.move(publishedMember.id, published.id, 2);
      yield* projects.move(draftMember.id, draft.id, 2);
      const publishedMemberAfter = Option.getOrThrow(yield* assets.findById(publishedMember.id));
      const draftMemberAfter = Option.getOrThrow(yield* assets.findById(draftMember.id));

      return {
        blockedUnpublish: yield* Effect.result(
          assertDirectAssetMutationAllowed(publishedMemberAfter, "unpublish", projects),
        ),
        blockedDelete: yield* Effect.result(
          assertDirectAssetMutationAllowed(publishedMemberAfter, "delete", projects),
        ),
        draftUnpublish: yield* Effect.result(
          assertDirectAssetMutationAllowed(draftMemberAfter, "unpublish", projects),
        ),
        draftDelete: yield* Effect.result(
          assertDirectAssetMutationAllowed(draftMemberAfter, "delete", projects),
        ),
        unfiledUnpublish: yield* Effect.result(
          assertDirectAssetMutationAllowed(unfiled, "unpublish", projects),
        ),
        unfiledDelete: yield* Effect.result(
          assertDirectAssetMutationAllowed(unfiled, "delete", projects),
        ),
      };
    }).pipe(Effect.provide(Layer.mergeAll(sql, repositories))),
  );

  for (const outcome of [result.blockedUnpublish, result.blockedDelete]) {
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({
        _tag: "PublishedProjectMemberMutationError",
        assetId: "published-member",
        projectId: "published",
      });
    }
  }
  for (const outcome of [
    result.draftUnpublish,
    result.draftDelete,
    result.unfiledUnpublish,
    result.unfiledDelete,
  ])
    expect(Result.isSuccess(outcome)).toBe(true);
});

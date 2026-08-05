import { SqliteClient } from "@effect/sql-sqlite-bun";
import { SqlClient } from "effect/unstable/sql";
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { Asset, AssetId, ProjectId, Slug } from "./Asset.ts";
import { AssetRepository } from "./AssetRepository.ts";
import { migrate } from "./Migrations.ts";
import { Project } from "./Project.ts";
import { ProjectRepository } from "./ProjectRepository.ts";

const layer = () => SqliteClient.layer({ filename: ":memory:" });
const asset = (id: string) =>
  new Asset({
    id: AssetId.make(id),
    slug: Slug.make(`asset_${id}`),
    kind: "video",
    title: id,
    description: null,
    posterKey: null,
    mediaKey: "",
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
const project = (id: string) =>
  new Project({
    id: ProjectId.make(id),
    slug: Slug.make(`project_${id}`),
    title: id,
    description: null,
    passwordHash: null,
    createdAt: 1,
    publishedAt: null,
    updatedAt: null,
  });
const repositoryLayer = () => {
  const database = layer();
  const repositories = Layer.mergeAll(
    AssetRepository.layerNoDeps,
    ProjectRepository.layerNoDeps,
  ).pipe(Layer.provide(database));
  return Layer.mergeAll(database, repositories);
};

const run = <A>(
  program: Effect.Effect<A, unknown, AssetRepository | ProjectRepository | SqlClient.SqlClient>,
) => Effect.runPromise(program.pipe(Effect.provide(repositoryLayer())));

describe("ProjectRepository", () => {
  test("clears both membership fields when deleting a project", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* assets.create(asset("b"));
        yield* assets.create(asset("c"));
        yield* projects.create(project("one"));
        yield* projects.create(project("two"));
        yield* projects.replaceMembers(
          ProjectId.make("one"),
          [AssetId.make("a"), AssetId.make("b")],
          10,
        );
        yield* projects.move(AssetId.make("a"), ProjectId.make("two"), 11);
        yield* projects.move(AssetId.make("b"), ProjectId.make("two"), 12, 0);
        const two = yield* projects.get(ProjectId.make("two"));
        expect(
          Option.getOrThrow(two).assets.map((member) => [String(member.id), member.sortOrder]),
        ).toEqual([
          ["b", 0],
          ["a", 1],
        ]);
        yield* projects.deleteAndUnfile(ProjectId.make("two"));
        return yield* assets.list();
      }),
    );
    expect(result.every((item) => item.projectId === null && item.sortOrder === null)).toBe(true);
  });

  test("records project and member publication together", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        const member = asset("a");
        const publication = project("one");
        yield* assets.create(member);
        yield* projects.create(publication);
        yield* projects.move(member.id, publication.id, 10);
        const aggregate = Option.getOrThrow(yield* projects.get(publication.id));
        yield* projects.markPublished([aggregate], 20);
        return {
          project: Option.getOrThrow(yield* projects.get(publication.id)),
          member: Option.getOrThrow(yield* assets.findById(member.id)),
        };
      }),
    );

    expect(result.project.project.publishedAt).toBe(20);
    expect(result.member.publishedAt).toBe(20);
  });

  test("unpublishing a project locally preserves member and direct asset publication", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        const member = new Asset({ ...asset("a"), publishedAt: 7 });
        const published = new Project({ ...project("one"), publishedAt: 8 });
        yield* assets.create(member);
        yield* projects.create(published);
        yield* projects.move(member.id, published.id, 10);
        const before = Option.getOrThrow(yield* projects.get(published.id));
        yield* projects.markPublished([before], 8);
        yield* projects.clearPublishedAt(published.id);
        return {
          project: Option.getOrThrow(yield* projects.get(published.id)),
          member: Option.getOrThrow(yield* assets.findById(member.id)),
          membership: yield* projects.findPublishedProjectMembership(member.id),
        };
      }),
    );

    expect(result.project.project.publishedAt).toBeNull();
    expect(result.project.assets).toHaveLength(1);
    expect(result.member).toMatchObject({ projectId: "one", publishedAt: 8 });
    expect(Option.isNone(result.membership)).toBe(true);
  });

  test("reorders within the same project without losing members", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* assets.create(asset("b"));
        yield* projects.create(project("one"));
        yield* projects.replaceMembers(
          ProjectId.make("one"),
          [AssetId.make("a"), AssetId.make("b")],
          10,
        );
        yield* projects.move(AssetId.make("b"), ProjectId.make("one"), 20, 0);
        return yield* projects.get(ProjectId.make("one"));
      }),
    );

    expect(
      Option.getOrThrow(result).assets.map((member) => [String(member.id), member.sortOrder]),
    ).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
    expect(Option.getOrThrow(result).project.updatedAt).toBe(20);
  });

  test("replaces members by unfiling removed assets", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* assets.create(asset("b"));
        yield* projects.create(project("one"));
        yield* projects.replaceMembers(
          ProjectId.make("one"),
          [AssetId.make("a"), AssetId.make("b")],
          10,
        );
        yield* projects.replaceMembers(ProjectId.make("one"), [AssetId.make("b")], 20);
        return yield* assets.list();
      }),
    );

    expect(result.find((member) => String(member.id) === "a")).toMatchObject({
      projectId: null,
      sortOrder: null,
    });
    expect(result.find((member) => String(member.id) === "b")).toMatchObject({
      projectId: "one",
      sortOrder: 0,
    });
  });

  test("rejects duplicate and unknown ordered member IDs", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* projects.create(project("one"));
        return yield* Effect.result(
          projects.replaceMembers(
            ProjectId.make("one"),
            [AssetId.make("a"), AssetId.make("a")],
            10,
          ),
        );
      }),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("InvalidProjectMembersError");
      if (result.failure._tag === "InvalidProjectMembersError") {
        expect(result.failure.reason).toBe("duplicateAssetId");
      }
    }
  });

  test("maps malformed persisted project rows to PersistenceError", async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const projects = yield* ProjectRepository;
        yield* migrate;
        yield* sql`
          INSERT INTO projects (id, slug, title, created_at)
          VALUES ('malformed', 'malformed', '', 1)
        `;
        return yield* Effect.result(projects.list());
      }),
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PersistenceError", operation: "decodeProjectSummary" },
    });
  });

  test("maps malformed persisted member rows to PersistenceError", async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const projects = yield* ProjectRepository;
        yield* migrate;
        yield* projects.create(project("one"));
        yield* sql`
          INSERT INTO assets (id, slug, kind, title, media_key, project_id, sort_order, created_at)
          VALUES ('malformed-asset', 'malformed_asset', 'video', '', 'media/malformed/master.m3u8', 'one', 0, 1)
        `;
        return yield* Effect.result(projects.get(ProjectId.make("one")));
      }),
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PersistenceError", operation: "decodeAsset" },
    });
  });

  test("returns slug conflicts as typed errors on create and update", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const projects = yield* ProjectRepository;
        yield* projects.create(project("one"));
        yield* projects.create(project("two"));
        const duplicateCreate = yield* Effect.result(
          projects.create(new Project({ ...project("three"), slug: Slug.make("project_one") })),
        );
        const duplicateUpdate = yield* Effect.result(
          projects.update(new Project({ ...project("two"), slug: Slug.make("project_one") })),
        );
        return { duplicateCreate, duplicateUpdate };
      }),
    );

    expect(result.duplicateCreate).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "SlugAlreadyExistsError", slug: "project_one" },
    });
    expect(result.duplicateUpdate).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "SlugAlreadyExistsError", slug: "project_one" },
    });
  });

  test("unfiles only a member of the specified source project and normalizes its order", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* assets.create(asset("b"));
        yield* projects.create(project("one"));
        yield* projects.create(project("two"));
        yield* projects.replaceMembers(
          ProjectId.make("one"),
          [AssetId.make("a"), AssetId.make("b")],
          10,
        );
        const rejected = yield* Effect.result(
          projects.unfileMember(ProjectId.make("two"), AssetId.make("a"), 20),
        );
        const before = yield* projects.get(ProjectId.make("one"));
        yield* projects.unfileMember(ProjectId.make("one"), AssetId.make("a"), 30);
        const after = yield* projects.get(ProjectId.make("one"));
        return { rejected, before: Option.getOrThrow(before), after: Option.getOrThrow(after) };
      }),
    );

    expect(result.rejected).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "InvalidProjectMembersError", reason: "notMemberOfProject" },
    });
    expect(result.before.assets.map((member) => String(member.id))).toEqual(["a", "b"]);
    expect(result.after.assets.map((member) => [String(member.id), member.sortOrder])).toEqual([
      ["b", 0],
    ]);
  });

  test("normalizes sparse positions without colliding with the partial unique index", async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* assets.create(asset("b"));
        yield* assets.create(asset("c"));
        yield* projects.create(project("one"));
        yield* projects.replaceMembers(
          ProjectId.make("one"),
          [AssetId.make("a"), AssetId.make("b"), AssetId.make("c")],
          10,
        );
        yield* sql`UPDATE assets SET sort_order = 999999999 WHERE id = 'b'`;
        yield* sql`UPDATE assets SET sort_order = 1000000000 WHERE id = 'c'`;
        yield* projects.unfileMember(ProjectId.make("one"), AssetId.make("b"), 20);
        return yield* projects.get(ProjectId.make("one"));
      }),
    );

    expect(
      Option.getOrThrow(result).assets.map((member) => [String(member.id), member.sortOrder]),
    ).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
  });

  test("reports a missing source project without mutating an asset", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        const rejected = yield* Effect.result(
          projects.unfileMember(ProjectId.make("missing"), AssetId.make("a"), 20),
        );
        return { rejected, asset: yield* assets.findById(AssetId.make("a")) };
      }),
    );

    expect(result.rejected).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ProjectNotFoundError", id: "missing" },
    });
    expect(Option.getOrThrow(result.asset)).toMatchObject({ projectId: null, sortOrder: null });
  });

  test("normalizes the former project when deleting a member asset", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* assets.create(asset("b"));
        yield* assets.create(asset("c"));
        yield* projects.create(project("one"));
        yield* projects.replaceMembers(
          ProjectId.make("one"),
          [AssetId.make("a"), AssetId.make("b"), AssetId.make("c")],
          10,
        );
        yield* assets.delete(AssetId.make("b"), 11);
        return yield* projects.get(ProjectId.make("one"));
      }),
    );

    expect(
      Option.getOrThrow(result).assets.map((member) => [String(member.id), member.sortOrder]),
    ).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
  });

  test("normalizes sparse positions after deleting a member asset", async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* assets.create(asset("b"));
        yield* assets.create(asset("c"));
        yield* projects.create(project("one"));
        yield* projects.replaceMembers(
          ProjectId.make("one"),
          [AssetId.make("a"), AssetId.make("b"), AssetId.make("c")],
          10,
        );
        yield* sql`UPDATE assets SET sort_order = 999999999 WHERE id = 'b'`;
        yield* sql`UPDATE assets SET sort_order = 1000000000 WHERE id = 'c'`;
        yield* assets.delete(AssetId.make("b"), 11);
        return yield* projects.get(ProjectId.make("one"));
      }),
    );

    expect(
      Option.getOrThrow(result).assets.map((member) => [String(member.id), member.sortOrder]),
    ).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
  });

  test("reports an unknown member exactly and timestamps source and destination", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* migrate;
        const assets = yield* AssetRepository;
        const projects = yield* ProjectRepository;
        yield* assets.create(asset("a"));
        yield* projects.create(project("one"));
        yield* projects.create(project("two"));
        yield* projects.replaceMembers(ProjectId.make("one"), [AssetId.make("a")], 10);
        yield* projects.move(AssetId.make("a"), ProjectId.make("two"), 20);
        const one = yield* projects.get(ProjectId.make("one"));
        const two = yield* projects.get(ProjectId.make("two"));
        const unknown = yield* Effect.result(
          projects.replaceMembers(ProjectId.make("two"), [AssetId.make("missing")], 30),
        );
        return { one: Option.getOrThrow(one), two: Option.getOrThrow(two), unknown };
      }),
    );
    expect(result.one.project.updatedAt).toBe(20);
    expect(result.two.project.updatedAt).toBe(20);
    expect(result.two.assets.map((member) => [String(member.id), member.sortOrder])).toEqual([
      ["a", 0],
    ]);
    expect(result.unknown).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "InvalidProjectMembersError", reason: "unknownAssetId" },
    });
  });
});

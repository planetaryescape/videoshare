import { Array, Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { AssetId, ProjectId, Slug } from "./Asset.ts";
import { assetFromRow, type AssetRow } from "./AssetRow.ts";
import { Project, ProjectAggregate, ProjectSummary } from "./Project.ts";
import {
  InvalidProjectMembersError,
  PersistenceError,
  ProjectNotFoundError,
  SlugAlreadyExistsError,
} from "./AssetErrors.ts";

type ExpectedError =
  | PersistenceError
  | ProjectNotFoundError
  | InvalidProjectMembersError
  | SlugAlreadyExistsError;
const isExpected = (cause: unknown): cause is ExpectedError =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  [
    "PersistenceError",
    "ProjectNotFoundError",
    "InvalidProjectMembersError",
    "SlugAlreadyExistsError",
  ].includes(String(cause._tag));
const wrap =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.mapError(effect, (cause) =>
      isExpected(cause) ? cause : new PersistenceError({ operation, cause }),
    );

interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  password_hash: string | null;
  created_at: number;
  published_at: number | null;
  updated_at: number | null;
}
const decodeProject = (row: ProjectRow): Effect.Effect<Project, PersistenceError> =>
  Effect.try({
    try: () =>
      new Project({
        id: ProjectId.make(row.id),
        slug: Slug.make(row.slug),
        title: row.title,
        description: row.description,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
      }),
    catch: (cause) => new PersistenceError({ operation: "decodeProject", cause }),
  });

const decodeAsset = (
  row: AssetRow,
): Effect.Effect<ReturnType<typeof assetFromRow>, PersistenceError> =>
  Effect.try({
    try: () => assetFromRow(row),
    catch: (cause) => new PersistenceError({ operation: "decodeAsset", cause }),
  });

const decodeSummary = (
  row: ProjectRow & { readonly member_count: number },
): Effect.Effect<ProjectSummary, PersistenceError> =>
  Effect.try({
    try: () =>
      new ProjectSummary({
        id: ProjectId.make(row.id),
        slug: Slug.make(row.slug),
        title: row.title,
        description: row.description,
        memberCount: row.member_count,
        createdAt: row.created_at,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
      }),
    catch: (cause) => new PersistenceError({ operation: "decodeProjectSummary", cause }),
  });

/** Owns every local project membership transition, including normalization of displaced projects. */
export class ProjectRepository extends Context.Service<
  ProjectRepository,
  {
    list(): Effect.Effect<ReadonlyArray<ProjectSummary>, PersistenceError>;
    get(id: ProjectId): Effect.Effect<Option.Option<ProjectAggregate>, PersistenceError>;
    create(
      project: Project,
    ): Effect.Effect<ProjectAggregate, PersistenceError | SlugAlreadyExistsError>;
    update(
      project: Project,
    ): Effect.Effect<
      ProjectAggregate,
      PersistenceError | ProjectNotFoundError | SlugAlreadyExistsError
    >;
    /** Records the complete remote project-membership snapshot after publication commits. */
    markPublished(
      aggregates: ReadonlyArray<ProjectAggregate>,
      publishedAt: number,
    ): Effect.Effect<void, PersistenceError>;
    /** Looks up the project that still owns an asset in the remote published snapshot. */
    findPublishedProjectMembership(
      assetId: AssetId,
    ): Effect.Effect<Option.Option<ProjectId>, PersistenceError>;
    /** Clears a project's local publication timestamp and remote-membership snapshot. */
    clearPublishedAt(id: ProjectId): Effect.Effect<void, PersistenceError>;
    replaceMembers(
      id: ProjectId,
      assetIds: ReadonlyArray<AssetId>,
      updatedAt: number,
    ): Effect.Effect<
      ProjectAggregate,
      PersistenceError | ProjectNotFoundError | InvalidProjectMembersError
    >;
    move(
      assetId: AssetId,
      destination: ProjectId | null,
      updatedAt: number,
      position?: number,
    ): Effect.Effect<void, PersistenceError | ProjectNotFoundError | InvalidProjectMembersError>;
    unfileMember(
      sourceProjectId: ProjectId,
      assetId: AssetId,
      updatedAt: number,
    ): Effect.Effect<void, PersistenceError | ProjectNotFoundError | InvalidProjectMembersError>;
    deleteAndUnfile(id: ProjectId): Effect.Effect<void, PersistenceError | ProjectNotFoundError>;
  }
>()("videoshare/ProjectRepository") {
  static readonly layerNoDeps: Layer.Layer<ProjectRepository, never, SqlClient.SqlClient> =
    Layer.effect(
      ProjectRepository,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const findProject = (id: ProjectId) =>
          sql<ProjectRow>`
            SELECT id, slug, title, description, password_hash, created_at, published_at, updated_at
            FROM projects
            WHERE id = ${id}
            LIMIT 1
          `.pipe(Effect.map(Array.head));
        const requireProject = Effect.fn("ProjectRepository.requireProject")(function* (
          id: ProjectId,
        ) {
          const row = yield* findProject(id);
          if (Option.isNone(row)) return yield* new ProjectNotFoundError({ id });
          return yield* decodeProject(row.value);
        });
        const aggregate = Effect.fn("ProjectRepository.aggregate")(function* (project: Project) {
          const rows =
            yield* sql<AssetRow>`SELECT * FROM assets WHERE project_id = ${project.id} ORDER BY sort_order`;
          return new ProjectAggregate({
            project,
            assets: yield* Effect.all(rows.map(decodeAsset)),
          });
        });
        const normalize = (projectId: ProjectId) =>
          Effect.gen(function* () {
            // Nonnegative positions map uniquely to negative values, leaving compacted positions free.
            yield* sql`UPDATE assets SET sort_order = -sort_order - 1 WHERE project_id = ${projectId}`;
            const rows = yield* sql<{
              id: string;
            }>`SELECT id FROM assets WHERE project_id = ${projectId} ORDER BY sort_order DESC`;
            for (const [index, row] of rows.entries())
              yield* sql`UPDATE assets SET sort_order = ${index} WHERE id = ${row.id}`;
          });
        const touch = (ids: ReadonlySet<ProjectId>, updatedAt: number) =>
          Effect.all(
            [...ids].map(
              (id) => sql`UPDATE projects SET updated_at = ${updatedAt} WHERE id = ${id}`,
            ),
          );

        const replaceMembersInTransaction = Effect.fn(
          "ProjectRepository.replaceMembersInTransaction",
        )(function* (id: ProjectId, ids: ReadonlyArray<AssetId>, updatedAt: number) {
          if (new Set(ids).size !== ids.length)
            return yield* new InvalidProjectMembersError({ reason: "duplicateAssetId" });
          const project = yield* requireProject(id);
          const sourceProjects = new Set<ProjectId>();
          for (const assetId of ids) {
            const found = yield* sql<{
              id: string;
              project_id: string | null;
            }>`SELECT id, project_id FROM assets WHERE id = ${assetId}`;
            if (!found[0])
              return yield* new InvalidProjectMembersError({ reason: "unknownAssetId" });
            if (found[0].project_id !== null && found[0].project_id !== id)
              sourceProjects.add(ProjectId.make(found[0].project_id));
          }
          // Unfile the destination first, then each requested member. This preserves one-to-many membership.
          yield* sql`UPDATE assets SET project_id = NULL, sort_order = NULL WHERE project_id = ${id}`;
          for (const assetId of ids)
            yield* sql`UPDATE assets SET project_id = NULL, sort_order = NULL WHERE id = ${assetId}`;
          for (const source of sourceProjects) yield* normalize(source);
          for (const [index, assetId] of ids.entries())
            yield* sql`UPDATE assets SET project_id = ${id}, sort_order = ${index} WHERE id = ${assetId}`;
          yield* touch(new Set([...sourceProjects, id]), updatedAt);
          return yield* aggregate(new Project({ ...project, updatedAt }));
        });

        return ProjectRepository.of({
          list: Effect.fn("ProjectRepository.list")(function* () {
            const rows = yield* sql<
              ProjectRow & { member_count: number }
            >`SELECT p.id, p.slug, p.title, p.description, p.password_hash, p.created_at, p.published_at, p.updated_at, COUNT(a.id) AS member_count FROM projects p LEFT JOIN assets a ON a.project_id = p.id GROUP BY p.id ORDER BY p.created_at DESC`;
            return yield* Effect.all(rows.map(decodeSummary));
          }, wrap("list")),
          get: Effect.fn("ProjectRepository.get")(function* (id: ProjectId) {
            const row = yield* findProject(id);
            return Option.isNone(row)
              ? Option.none()
              : Option.some(yield* aggregate(yield* decodeProject(row.value)));
          }, wrap("get")),
          create: Effect.fn("ProjectRepository.create")(function* (project: Project) {
            return yield* sql.withTransaction(
              Effect.gen(function* () {
                const existing = yield* sql<{
                  readonly id: string;
                }>`SELECT id FROM projects WHERE slug = ${project.slug}`;
                if (existing.length > 0)
                  return yield* new SlugAlreadyExistsError({ slug: project.slug });
                yield* sql`INSERT INTO projects (id, slug, title, description, password_hash, created_at, published_at, updated_at) VALUES (${project.id}, ${project.slug}, ${project.title}, ${project.description}, ${project.passwordHash}, ${project.createdAt}, ${project.publishedAt}, ${project.updatedAt})`;
                return yield* aggregate(project);
              }),
            );
          }, wrap("create")),
          update: Effect.fn("ProjectRepository.update")(function* (project: Project) {
            return yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* requireProject(project.id);
                const existing = yield* sql<{
                  readonly id: string;
                }>`SELECT id FROM projects WHERE slug = ${project.slug} AND id != ${project.id}`;
                if (existing.length > 0)
                  return yield* new SlugAlreadyExistsError({ slug: project.slug });
                yield* sql`UPDATE projects SET slug=${project.slug}, title=${project.title}, description=${project.description}, password_hash=${project.passwordHash}, published_at=${project.publishedAt}, updated_at=${project.updatedAt} WHERE id=${project.id}`;
                return yield* aggregate(project);
              }),
            );
          }, wrap("update")),
          markPublished: (aggregates, publishedAt) =>
            sql
              .withTransaction(
                Effect.gen(function* () {
                  // A successful full-catalog replacement supersedes every previous remote membership.
                  yield* sql`DELETE FROM published_project_members`;
                  yield* Effect.forEach(aggregates, ({ project, assets }) =>
                    Effect.gen(function* () {
                      yield* sql`UPDATE projects SET published_at=${publishedAt} WHERE id=${project.id}`;
                      yield* sql`UPDATE assets SET published_at=${publishedAt} WHERE project_id=${project.id}`;
                      yield* Effect.forEach(
                        assets,
                        (asset) =>
                          sql`INSERT INTO published_project_members (asset_id, project_id) VALUES (${asset.id}, ${project.id})`,
                      );
                    }),
                  );
                }),
              )
              .pipe(Effect.asVoid, wrap("markPublished")),
          findPublishedProjectMembership: (assetId) =>
            sql<{ readonly project_id: string }>`
              SELECT project_id FROM published_project_members WHERE asset_id = ${assetId} LIMIT 1
            `.pipe(
              Effect.map((rows) =>
                Option.fromNullishOr(rows[0]?.project_id).pipe(Option.map(ProjectId.make)),
              ),
              wrap("findPublishedProjectMembership"),
            ),
          clearPublishedAt: (id) =>
            sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* sql`UPDATE projects SET published_at=NULL WHERE id=${id}`;
                  yield* sql`DELETE FROM published_project_members WHERE project_id=${id}`;
                }),
              )
              .pipe(Effect.asVoid, wrap("clearPublishedAt")),
          unfileMember: Effect.fn("ProjectRepository.unfileMember")(function* (
            sourceProjectId: ProjectId,
            assetId: AssetId,
            updatedAt: number,
          ) {
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* requireProject(sourceProjectId);
                const unfiled = yield* sql<{ readonly id: string }>`
                  UPDATE assets
                  SET project_id = NULL, sort_order = NULL
                  WHERE id = ${assetId} AND project_id = ${sourceProjectId}
                  RETURNING id
                `;
                if (unfiled.length === 0)
                  return yield* new InvalidProjectMembersError({ reason: "notMemberOfProject" });
                yield* normalize(sourceProjectId);
                yield* touch(new Set([sourceProjectId]), updatedAt);
              }),
            );
          }, wrap("unfileMember")),

          replaceMembers: (id, ids, updatedAt) =>
            sql
              .withTransaction(replaceMembersInTransaction(id, ids, updatedAt))
              .pipe(wrap("replaceMembers")),
          move: Effect.fn("ProjectRepository.move")(function* (
            assetId: AssetId,
            destination: ProjectId | null,
            updatedAt: number,
            position?: number,
          ) {
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const current = yield* sql<{
                  project_id: string | null;
                }>`SELECT project_id FROM assets WHERE id=${assetId}`;
                if (!current[0])
                  return yield* new InvalidProjectMembersError({ reason: "unknownAssetId" });
                if (destination === null) {
                  const old =
                    current[0].project_id === null ? null : ProjectId.make(current[0].project_id);
                  yield* sql`UPDATE assets SET project_id=NULL, sort_order=NULL WHERE id=${assetId}`;
                  if (old !== null) {
                    yield* normalize(old);
                    yield* touch(new Set([old]), updatedAt);
                  }
                  return;
                }
                yield* requireProject(destination);
                const members = yield* sql<{
                  id: string;
                }>`SELECT id FROM assets WHERE project_id=${destination} AND id != ${assetId} ORDER BY sort_order`;
                const ids = members.map((member) => AssetId.make(member.id));
                const at = Math.max(0, Math.min(position ?? ids.length, ids.length));
                ids.splice(at, 0, assetId);
                yield* replaceMembersInTransaction(destination, ids, updatedAt);
              }),
            );
          }, wrap("move")),
          deleteAndUnfile: Effect.fn("ProjectRepository.deleteAndUnfile")(function* (
            id: ProjectId,
          ) {
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* requireProject(id);
                yield* sql`UPDATE assets SET project_id=NULL, sort_order=NULL WHERE project_id=${id}`;
                yield* sql`DELETE FROM published_project_members WHERE project_id=${id}`;
                yield* sql`DELETE FROM projects WHERE id=${id}`;
              }),
            );
          }, wrap("deleteAndUnfile")),
        });
      }),
    );
}

import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Project } from "@videoshare/shared/Project";
import { ProjectId } from "@videoshare/shared/Asset";
import { ProjectNotFoundError } from "@videoshare/shared/AssetErrors";
import { generateSlug } from "@videoshare/shared/Slug";
import { projectPasswordHash } from "../../projects/password.ts";
import { projectDetailFromAggregate } from "../../projects/projectDto.ts";
import { AdminApi } from "../AdminApi.ts";

// This is the strict HTTP boundary for plaintext project passwords. Repositories only receive hashes.
const requireAggregate = (repo: typeof ProjectRepository.Service, id: ProjectId) =>
  Effect.gen(function* () {
    const found = yield* repo.get(id);
    if (Option.isNone(found)) return yield* new ProjectNotFoundError({ id });
    return found.value;
  });

export const ProjectsApiLive = HttpApiBuilder.group(AdminApi, "projects", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* ProjectRepository;
    return handlers
      .handle("listProjects", () => repo.list())
      .handle("getProject", ({ params }) =>
        requireAggregate(repo, ProjectId.make(params.id)).pipe(
          Effect.map(projectDetailFromAggregate),
        ),
      )
      .handle("createProject", ({ payload }) =>
        Effect.gen(function* () {
          const passwordHash = yield* projectPasswordHash(payload.password);
          const project = new Project({
            id: ProjectId.make(crypto.randomUUID()),
            slug: generateSlug(),
            title: payload.title,
            description: payload.description ?? null,
            passwordHash: passwordHash ?? null,
            createdAt: Date.now(),
            publishedAt: null,
            updatedAt: null,
          });
          return projectDetailFromAggregate(yield* repo.create(project));
        }),
      )
      .handle("updateProject", ({ params, payload }) =>
        Effect.gen(function* () {
          const current = (yield* requireAggregate(repo, ProjectId.make(params.id))).project;
          const passwordHash = yield* projectPasswordHash(payload.password);
          return projectDetailFromAggregate(
            yield* repo.update(
              new Project({
                ...current,
                slug: payload.slug ?? current.slug,
                title: payload.title ?? current.title,
                description: payload.description ?? current.description,
                passwordHash: passwordHash === undefined ? current.passwordHash : passwordHash,
                updatedAt: Date.now(),
              }),
            ),
          );
        }),
      )
      .handle("replaceMembers", ({ params, payload }) =>
        repo
          .replaceMembers(ProjectId.make(params.id), payload.assetIds, Date.now())
          .pipe(Effect.map(projectDetailFromAggregate)),
      )
      .handle("moveMember", ({ params, payload }) =>
        Effect.gen(function* () {
          const id = ProjectId.make(params.id);
          yield* repo.move(payload.assetId, id, Date.now(), payload.position);
          return projectDetailFromAggregate(yield* requireAggregate(repo, id));
        }),
      )
      .handle("unfileMember", ({ params }) =>
        Effect.gen(function* () {
          const id = ProjectId.make(params.id);
          yield* repo.unfileMember(id, params.assetId, Date.now());
          return projectDetailFromAggregate(yield* requireAggregate(repo, id));
        }),
      )
      .handle("deleteProject", ({ params }) =>
        repo.deleteAndUnfile(ProjectId.make(params.id)).pipe(Effect.as({ success: true })),
      );
  }),
);

import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Option } from "effect";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { Project } from "@videoshare/shared/Project";
import { ProjectId } from "@videoshare/shared/Asset";
import {
  ProjectNotFoundError,
  ProjectPublicationValidationError,
} from "@videoshare/shared/AssetErrors";
import { generateSlug } from "@videoshare/shared/Slug";
import { projectPasswordHash } from "../../projects/password.ts";
import { projectDetailFromAggregate } from "../../projects/projectDto.ts";
import { AdminApi } from "../AdminApi.ts";
import { Publisher } from "../../prod.ts";
import { PublicationGate } from "../../services/PublicationGate.ts";

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
    const publisher = yield* Publisher;
    const gate = yield* PublicationGate;
    return handlers
      .handle("listProjects", () => repo.list())
      .handle("getProject", ({ params }) =>
        requireAggregate(repo, ProjectId.make(params.id)).pipe(
          Effect.map(projectDetailFromAggregate),
        ),
      )
      .handle("createProject", ({ payload }) =>
        gate.serialize(
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
        ),
      )
      .handle("updateProject", ({ params, payload }) =>
        gate.serialize(
          Effect.gen(function* () {
            const current = (yield* requireAggregate(repo, ProjectId.make(params.id))).project;
            if (
              current.publishedAt !== null &&
              payload.slug !== undefined &&
              payload.slug !== current.slug
            )
              return yield* new ProjectPublicationValidationError({
                projectId: current.id,
                reason: "publishedSlugChange",
              });
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
        ),
      )
      .handle("replaceMembers", ({ params, payload }) =>
        gate.serialize(
          repo
            .replaceMembers(ProjectId.make(params.id), payload.assetIds, Date.now())
            .pipe(Effect.map(projectDetailFromAggregate)),
        ),
      )
      .handle("moveMember", ({ params, payload }) =>
        gate.serialize(
          Effect.gen(function* () {
            const id = ProjectId.make(params.id);
            yield* repo.move(payload.assetId, id, Date.now(), payload.position);
            return projectDetailFromAggregate(yield* requireAggregate(repo, id));
          }),
        ),
      )
      .handle("unfileMember", ({ params }) =>
        gate.serialize(
          Effect.gen(function* () {
            const id = ProjectId.make(params.id);
            yield* repo.unfileMember(id, params.assetId, Date.now());
            return projectDetailFromAggregate(yield* requireAggregate(repo, id));
          }),
        ),
      )
      .handle("publishProject", ({ params }) =>
        gate.serialize(
          Effect.gen(function* () {
            const id = ProjectId.make(params.id);
            yield* publisher.publishProject(id);
            return projectDetailFromAggregate(yield* requireAggregate(repo, id));
          }),
        ),
      )
      .handle("unpublishProject", ({ params }) =>
        gate.serialize(
          Effect.gen(function* () {
            const id = ProjectId.make(params.id);
            yield* publisher.unpublishProject(id);
            return projectDetailFromAggregate(yield* requireAggregate(repo, id));
          }),
        ),
      )
      .handle("deleteProject", ({ params }) =>
        gate.serialize(
          Effect.gen(function* () {
            const id = ProjectId.make(params.id);
            const found = yield* repo.get(id);
            if (Option.isNone(found)) return yield* new ProjectNotFoundError({ id });
            yield* publisher.removeProject(id);
            yield* repo.deleteAndUnfile(id);
            return { success: true };
          }),
        ),
      );
  }),
);

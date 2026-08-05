import { Context, Effect, Layer, Option, Semaphore } from "effect";
import type { Asset } from "@videoshare/shared/Asset";
import type { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { PublishedProjectMemberMutationError } from "@videoshare/shared/AssetErrors";

/** Rejects direct mutations that would invalidate a locally published project snapshot. */
export const assertDirectAssetMutationAllowed = (
  asset: Asset,
  operation: "upload" | "publish" | "unpublish" | "delete",
  projects: typeof ProjectRepository.Service,
) =>
  Effect.gen(function* () {
    if (asset.projectId === null) return;
    const project = yield* projects.get(asset.projectId);
    if (Option.isSome(project) && project.value.project.publishedAt !== null)
      return yield* new PublishedProjectMemberMutationError({
        assetId: asset.id,
        projectId: asset.projectId,
        operation,
      });
  });

/** Serializes admin mutations with publication within this server process. */
export class PublicationGate extends Context.Service<
  PublicationGate,
  {
    readonly serialize: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("admin/PublicationGate") {
  static readonly layer = Layer.sync(PublicationGate, () => {
    const semaphore = Semaphore.makeUnsafe(1);
    return PublicationGate.of({ serialize: semaphore.withPermit });
  });
}

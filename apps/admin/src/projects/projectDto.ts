import type { Asset } from "@videoshare/shared/Asset";
import type { ProjectAggregate } from "@videoshare/shared/Project";
import type {
  BrowserProjectAsset as BrowserProjectAssetContract,
  ProjectDetail as ProjectDetailContract,
} from "./contracts.ts";

export { BrowserProjectAsset, ProjectDetail } from "./contracts.ts";

const browserProjectAsset = (asset: Asset): typeof BrowserProjectAssetContract.Type => ({
  id: asset.id,
  slug: asset.slug,
  kind: asset.kind,
  title: asset.title,
  description: asset.description,
  posterKey: asset.posterKey,
  mediaKey: asset.mediaKey,
  durationSec: asset.durationSec,
  width: asset.width,
  height: asset.height,
  projectId: asset.projectId,
  sortOrder: asset.sortOrder,
  createdAt: asset.createdAt,
  publishedAt: asset.publishedAt,
  updatedAt: asset.updatedAt,
});

/** Projects the secret-bearing persistence aggregate into its browser response DTO. */
export const projectDetailFromAggregate = (aggregate: ProjectAggregate): ProjectDetailContract => ({
  project: {
    id: aggregate.project.id,
    slug: aggregate.project.slug,
    title: aggregate.project.title,
    description: aggregate.project.description,
    createdAt: aggregate.project.createdAt,
    publishedAt: aggregate.project.publishedAt,
    updatedAt: aggregate.project.updatedAt,
  },
  assets: aggregate.assets.map(browserProjectAsset),
});

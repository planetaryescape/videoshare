import { Schema } from "effect";
import { Kind } from "@videoshare/shared/Asset";

/** Browser-safe asset response projection. It intentionally excludes passwordHash. */
export const BrowserProjectAsset = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  kind: Kind,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  posterKey: Schema.NullOr(Schema.String),
  mediaKey: Schema.String,
  durationSec: Schema.Finite,
  width: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  height: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  projectId: Schema.NullOr(Schema.String),
  sortOrder: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  createdAt: Schema.Finite,
  publishedAt: Schema.NullOr(Schema.Finite),
  updatedAt: Schema.NullOr(Schema.Finite),
  body: Schema.optional(Schema.String),
});

/** Browser-safe project metadata response projection. It intentionally excludes passwordHash. */
export const ProjectMetadata = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.Finite,
  publishedAt: Schema.NullOr(Schema.Finite),
  updatedAt: Schema.NullOr(Schema.Finite),
});

/** HTTP response shape for a project and its browser-safe member assets. */
export const ProjectDetail = Schema.Struct({
  project: ProjectMetadata,
  assets: Schema.Array(BrowserProjectAsset),
});
export type ProjectDetail = typeof ProjectDetail.Type;

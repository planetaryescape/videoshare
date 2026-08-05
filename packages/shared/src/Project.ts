import { Schema } from "effect";
import { Asset, ProjectId, Slug } from "./Asset.ts";

const NonBlankTitle = Schema.String.check(Schema.isPattern(/\S/));

export { ProjectId } from "./Asset.ts";

export class Project extends Schema.Class<Project>("Project")({
  id: ProjectId,
  slug: Slug,
  title: NonBlankTitle,
  description: Schema.NullOr(Schema.String),
  passwordHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  publishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.NullOr(Schema.Number),
}) {}

/** A project and its ordered local members. Hashes remain server-internal and are stripped from browser DTOs. */
export class ProjectAggregate extends Schema.Class<ProjectAggregate>("ProjectAggregate")({
  project: Project,
  assets: Schema.Array(Asset),
}) {}

export class ProjectSummary extends Schema.Class<ProjectSummary>("ProjectSummary")({
  id: ProjectId,
  slug: Slug,
  title: NonBlankTitle,
  description: Schema.NullOr(Schema.String),
  memberCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  createdAt: Schema.Number,
  publishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.NullOr(Schema.Number),
}) {}

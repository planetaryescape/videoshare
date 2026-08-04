import { describe, expect, test } from "vitest";
import { Schema } from "effect";
import { Asset, AssetId, ProjectId, Slug } from "@videoshare/shared/Asset";
import { Project, ProjectAggregate } from "@videoshare/shared/Project";
import { ProjectDetailSchema } from "../model.ts";
import { ProjectDetail, projectDetailFromAggregate } from "./projectDto.ts";
import { ProjectDetail as ProjectDetailContract } from "./contracts.ts";

const aggregate = new ProjectAggregate({
  project: new Project({
    id: ProjectId.make("project-1"),
    slug: Slug.make("project_1"),
    title: "Project",
    description: null,
    passwordHash: "project-secret",
    createdAt: 1,
    publishedAt: null,
    updatedAt: null,
  }),
  assets: [
    new Asset({
      id: AssetId.make("asset-1"),
      slug: Slug.make("asset_1"),
      kind: "video",
      title: "Asset",
      description: null,
      posterKey: null,
      mediaKey: "media/asset-1/master.m3u8",
      durationSec: 1,
      width: null,
      height: null,
      passwordHash: "asset-secret",
      projectId: ProjectId.make("project-1"),
      sortOrder: 0,
      createdAt: 1,
      publishedAt: null,
      updatedAt: null,
    }),
  ],
});

describe("projectDetailFromAggregate", () => {
  test("shares one browser-safe contract between the server projection and browser model", () => {
    expect(ProjectDetail).toBe(ProjectDetailContract);
    expect(ProjectDetailSchema).toBe(ProjectDetailContract);
  });

  test("projects secret-bearing aggregates into the browser-safe detail DTO", () => {
    const projected = projectDetailFromAggregate(aggregate);

    expect(projected).toEqual({
      project: {
        id: "project-1",
        slug: "project_1",
        title: "Project",
        description: null,
        createdAt: 1,
        publishedAt: null,
        updatedAt: null,
      },
      assets: [
        {
          id: "asset-1",
          slug: "asset_1",
          kind: "video",
          title: "Asset",
          description: null,
          posterKey: null,
          mediaKey: "media/asset-1/master.m3u8",
          durationSec: 1,
          width: null,
          height: null,
          projectId: "project-1",
          sortOrder: 0,
          createdAt: 1,
          publishedAt: null,
          updatedAt: null,
        },
      ],
    });
    expect(JSON.stringify(projected)).not.toContain("secret");
    expect(Schema.decodeUnknownSync(ProjectDetail)(projected)).toEqual(projected);
  });
});

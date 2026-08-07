import { expect, test } from "bun:test";
import { Schema } from "effect";
import { Asset, AssetId, Kind, ProjectId, Slug } from "./Asset.ts";

const fields = {
  id: AssetId.make("asset-1"),
  slug: Slug.make("asset_1"),
  kind: "video",
  title: "Asset",
  description: null,
  posterKey: null,
  mediaKey: "media/asset-1/master.m3u8",
  durationSec: 0,
  width: null,
  height: null,
  passwordHash: null,
  projectId: null,
  sortOrder: null,
  createdAt: 1,
  publishedAt: null,
  updatedAt: null,
} satisfies (typeof Asset)["~type.make.in"];

test("Asset construction requires projectId and sortOrder to be both set or both null", () => {
  expect(() => new Asset({ ...fields, projectId: ProjectId.make("project-1") })).toThrow(
    "projectId and sortOrder",
  );
  expect(() => new Asset({ ...fields, sortOrder: 0 })).toThrow("projectId and sortOrder");
  expect(new Asset(fields)).toMatchObject({ projectId: null, sortOrder: null });
  expect(
    new Asset({ ...fields, projectId: ProjectId.make("project-1"), sortOrder: 0 }),
  ).toMatchObject({ projectId: "project-1", sortOrder: 0 });
});

test("Asset reserves the project summary route", () => {
  expect(() => new Asset({ ...fields, slug: Slug.make("summary") })).toThrow("reserved");
});

test("Asset decoding requires projectId and sortOrder to be both set or both null", () => {
  expect(() => Schema.decodeUnknownSync(Asset)({ ...fields, projectId: "project-1" })).toThrow(
    "projectId and sortOrder",
  );
  expect(() => Schema.decodeUnknownSync(Asset)({ ...fields, sortOrder: 0 })).toThrow(
    "projectId and sortOrder",
  );
});

test("Kind accepts markdown alongside video, audio and image", () => {
  expect(Schema.decodeUnknownSync(Kind)("markdown")).toBe("markdown");
  expect(() => Schema.decodeUnknownSync(Kind)("document")).toThrow();
});

test("Asset accepts a markdown kind with zero duration and null dimensions", () => {
  const markdown = new Asset({
    ...fields,
    kind: "markdown",
    mediaKey: "media/asset-1/content.md",
  });
  expect(markdown).toMatchObject({ kind: "markdown", durationSec: 0, width: null, height: null });
});

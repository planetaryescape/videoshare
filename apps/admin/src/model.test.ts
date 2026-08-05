import { expect, test } from "vitest";
import { hasProjectUnpublishedChanges, type Asset, type ProjectDetail } from "./model";

const member = (
  overrides: Readonly<{
    updatedAt?: number | null;
    publishedAt?: number | null;
    createdAt?: number;
  }> = {},
): Asset => ({
  id: "member-1",
  slug: "member-1",
  kind: "video",
  title: "Member",
  description: null,
  posterKey: null,
  mediaKey: "media/member-1/master.m3u8",
  durationSec: 1,
  width: null,
  height: null,
  createdAt: 1,
  publishedAt: 10,
  updatedAt: null,
  projectId: "project-1",
  sortOrder: 0,
  ...overrides,
});

const publishedProject = (assets: ReadonlyArray<Asset>): ProjectDetail => ({
  project: {
    id: "project-1",
    slug: "project-1",
    title: "Project",
    description: null,
    createdAt: 1,
    publishedAt: 10,
    updatedAt: 10,
  },
  assets,
});

test("compares published project members to the project snapshot", () => {
  expect(hasProjectUnpublishedChanges(publishedProject([member()]))).toBe(false);
  expect(hasProjectUnpublishedChanges(publishedProject([member({ updatedAt: 11 })]))).toBe(true);
  expect(hasProjectUnpublishedChanges(publishedProject([member({ createdAt: 11 })]))).toBe(true);
  expect(
    hasProjectUnpublishedChanges(publishedProject([member({ updatedAt: 11, publishedAt: 12 })])),
  ).toBe(true);
  expect(hasProjectUnpublishedChanges(publishedProject([member({ publishedAt: null })]))).toBe(
    true,
  );
  expect(hasProjectUnpublishedChanges(publishedProject([member({ publishedAt: 9 })]))).toBe(true);
  const membershipChanged = publishedProject([member()]);
  expect(
    hasProjectUnpublishedChanges({
      ...membershipChanged,
      project: { ...membershipChanged.project, updatedAt: 11 },
    }),
  ).toBe(true);
});

test("flags a draft project when its metadata or members are unpublished", () => {
  const draft = publishedProject([member({ publishedAt: null })]);
  expect(
    hasProjectUnpublishedChanges({ ...draft, project: { ...draft.project, publishedAt: null } }),
  ).toBe(true);
  expect(
    hasProjectUnpublishedChanges({
      ...draft,
      project: { ...draft.project, publishedAt: null, updatedAt: null },
      assets: [member({ publishedAt: 10 })],
    }),
  ).toBe(false);
});

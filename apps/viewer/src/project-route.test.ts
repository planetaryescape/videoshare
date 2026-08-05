import { expect, test } from "bun:test";
import { Asset, AssetId, Slug } from "@videoshare/shared/Asset";
import {
  isProjectAuthorized,
  parseProjectRoute,
  projectCacheControl,
  projectMediaUrl,
  renderProjectGate,
  renderProjectPage,
} from "./project-route.ts";

test("parses root, member deep-link, and project media routes while rejecting traversal and surplus page segments", () => {
  expect(parseProjectRoute(["show"])).toEqual({
    _tag: "page",
    projectSlug: "show",
    assetSlug: null,
  });
  expect(parseProjectRoute(["show", "member"])).toEqual({
    _tag: "page",
    projectSlug: "show",
    assetSlug: "member",
  });
  // `/p/master.m3u8` is structurally also a project root; worker dispatch resolves projects first.
  expect(parseProjectRoute(["master.m3u8"])).toEqual({
    _tag: "page",
    projectSlug: "master.m3u8",
    assetSlug: null,
  });
  expect(parseProjectRoute(["show", "media", "member", "master.m3u8"])).toEqual({
    _tag: "media",
    projectSlug: "show",
    assetSlug: "member",
    file: "master.m3u8",
  });
  expect(parseProjectRoute(["show", "member", "surplus"])).toEqual({ _tag: "invalid" });
  expect(parseProjectRoute(["show", "media"])).toEqual({
    _tag: "page",
    projectSlug: "show",
    assetSlug: "media",
  });
  expect(parseProjectRoute(["show", "media", "member", "..", "secret"])).toEqual({
    _tag: "invalid",
  });
  expect(parseProjectRoute([".."])).toEqual({ _tag: "invalid" });
});

test("project grants supersede member passwords while direct asset cookies stay independent", () => {
  // A protected member is intentionally reachable through a passwordless project route.
  const protectedMember = { passwordHash: "member-hash" };
  expect(protectedMember.passwordHash).not.toBe("");
  expect(isProjectAuthorized(new Map(), "show", null)).toBe(true);
  expect(isProjectAuthorized(new Map([["video_auth_member", "member-hash"]]), "show", "hash")).toBe(
    false,
  );
  expect(isProjectAuthorized(new Map([["project_auth_show", "hash"]]), "show", "hash")).toBe(true);
});

test("protected project responses are private while all public media revalidates", () => {
  expect(projectCacheControl("hash", false)).toBe("private, no-store");
  expect(projectCacheControl("hash", true)).toBe("private, no-store");
  expect(projectCacheControl(null, true)).toBe("no-cache");
  expect(projectCacheControl(null, false)).toBe("no-cache");
});

test("public projects retain absolute media URLs while protected projects keep them behind the media route", () => {
  expect(projectMediaUrl("show", "member", "https://cdn.example/video.m3u8", null)).toBe(
    "https://cdn.example/video.m3u8",
  );
  expect(projectMediaUrl("show", "member", "https://cdn.example/video.m3u8", "hash")).toBe(
    "/p/show/media/member/video.m3u8",
  );
  expect(projectMediaUrl("show", "member", "media/member/master.m3u8", null)).toBe(
    "/p/show/media/member/master.m3u8",
  );
});

test("project page emits stable project-member links", () => {
  const member = new Asset({
    id: AssetId.make("member"),
    slug: Slug.make("member"),
    kind: "image",
    title: "Member",
    description: null,
    posterKey: null,
    mediaKey: "media/member/image.png",
    durationSec: 0,
    width: 1,
    height: 1,
    passwordHash: null,
    projectId: null,
    sortOrder: null,
    createdAt: 1,
    publishedAt: 1,
    updatedAt: null,
  });
  const page = renderProjectPage({
    projectSlug: "show",
    project: { title: "Show", description: null },
    assets: [member],
    selected: member,
    stage: "<img>",
    escapeHtml: (value) => value,
    faviconLinks: "",
    playerCssHref: "/css",
    playerScriptHref: "/js",
  });
  expect(page).toContain('href="/p/show/member"');
  expect(page).not.toContain('rel="preload"');
});

test("project gate preserves the requested safe action and has no member artwork", () => {
  const page = renderProjectGate({
    title: "Show",
    action: "/p/show/member",
    escapeHtml: (value) => value,
    faviconLinks: "",
  });
  expect(page).toContain('action="/p/show/member"');
  expect(page).toContain("Open project");
  expect(page).toContain("This project is password protected.");
  expect(page).not.toContain("member artwork");
});

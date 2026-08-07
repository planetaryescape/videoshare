import { describe, expect, test } from "bun:test";
import { Asset, AssetId, Slug } from "@videoshare/shared/Asset";
import { renderStage } from "./stage.ts";

const asset = (kind: "video" | "audio" | "image" | "markdown") =>
  new Asset({
    id: AssetId.make("asset-1"),
    slug: Slug.make("asset_1"),
    kind,
    title: "A <title>",
    description: null,
    posterKey: null,
    mediaKey: "media/asset-1/original.png",
    durationSec: 0,
    width: kind === "image" ? 640 : null,
    height: kind === "image" ? 480 : null,
    passwordHash: "secret",
    projectId: null,
    sortOrder: null,
    createdAt: 1,
    publishedAt: 2,
    updatedAt: 3,
  });

describe("renderStage", () => {
  test("renders images with the authenticated direct media URL", () => {
    const html = renderStage(asset("image"), "/asset_1/original.png", null, null);

    expect(html).toContain('<img src="/asset_1/original.png"');
    expect(html).not.toContain("media-player");
    expect(html).toContain('alt="A &lt;title&gt;"');
  });

  test("keeps timed media on Vidstack", () => {
    const html = renderStage(asset("video"), "/asset_1/master.m3u8", "/asset_1/poster.jpg", null);

    expect(html).toContain("<media-player");
    expect(html).toContain('src="/asset_1/master.m3u8"');
    expect(html).toContain('poster="/asset_1/poster.jpg"');
  });

  test("inlines pre-rendered markdown HTML without escaping it", () => {
    const html = renderStage(
      asset("markdown"),
      "/asset_1/content.md",
      null,
      null,
      "<p>Hello <strong>world</strong></p>",
    );

    expect(html).toBe(
      '<article class="markdown-stage"><p>Hello <strong>world</strong></p></article>',
    );
  });

  test("renders an empty article when markdownHtml is null", () => {
    const html = renderStage(asset("markdown"), "/asset_1/content.md", null, null, null);

    expect(html).toBe('<article class="markdown-stage"></article>');
  });

  test("renders an empty article when markdownHtml is undefined", () => {
    const html = renderStage(asset("markdown"), "/asset_1/content.md", null, null);

    expect(html).toBe('<article class="markdown-stage"></article>');
  });
});

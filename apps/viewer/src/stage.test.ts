import { describe, expect, test } from "bun:test";
import { Asset, AssetId, Slug } from "@videoshare/shared/Asset";
import { renderStage } from "./stage.ts";

const asset = (kind: "video" | "audio" | "image") =>
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
});

import { describe, expect, test } from "bun:test";
import { Asset, AssetId, Slug } from "@videoshare/shared/Asset";
import { renderOpenGraphTags } from "./worker.ts";

const imageAsset = new Asset({
  id: AssetId.make("image-1"),
  slug: Slug.make("image_1"),
  kind: "image",
  title: "Image",
  description: null,
  posterKey: null,
  mediaKey: "media/image-1/original.webp",
  durationSec: 0,
  width: 640,
  height: 480,
  passwordHash: null,
  projectId: null,
  sortOrder: null,
  createdAt: 1,
  publishedAt: 2,
  updatedAt: 3,
});

describe("renderOpenGraphTags", () => {
  test("uses an image asset's direct media URL when it has no poster", () => {
    const tags = renderOpenGraphTags("https://viewer.example", "image_1", imageAsset);

    expect(tags).toContain(
      '<meta property="og:image" content="https://viewer.example/image_1/original.webp">',
    );
    expect(tags).toContain(
      '<meta name="twitter:image" content="https://viewer.example/image_1/original.webp">',
    );
  });
});

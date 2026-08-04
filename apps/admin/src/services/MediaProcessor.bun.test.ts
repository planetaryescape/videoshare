import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Result } from "effect";
import { afterEach, describe, expect, test } from "bun:test";
import { InvalidImageError, UnsupportedMediaError } from "../errors/MediaErrors.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { MediaProcessor } from "./MediaProcessor.ts";
import { Storage } from "./Storage.ts";

const platformLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const storageLayer = Storage.layer.pipe(Layer.provide(platformLayer));
const dependencies = Layer.mergeAll(ProgressBus.layer, storageLayer);
const layer = Layer.provideMerge(MediaProcessor.layer, dependencies);
const assetIds = [
  "image-jpeg",
  "image-png",
  "image-webp",
  "image-svg",
  "image-gif",
  "image-corrupt-jpeg",
  "image-corrupt-png",
  "image-corrupt-webp",
  "image-header-only-gif",
];

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const jpeg = bytes(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ar//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/If/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//Z",
);
const png = bytes(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JYqkAAAAASUVORK5CYII=",
);
const webp = bytes("UklGRiIAAABXRUJQVlA4IBYAAABwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=");

const process = (assetId: string, file: File) =>
  Effect.gen(function* () {
    const processor = yield* MediaProcessor;
    const storage = yield* Storage;
    const processed = yield* processor.process(assetId, file);
    return {
      processed,
      stored: yield* storage.readFile(`${assetId}/${processed.filename}`),
      hasHls: yield* storage.exists(`${assetId}/master.m3u8`),
    };
  }).pipe(Effect.provide(layer));

const processEither = (assetId: string, file: File) =>
  Effect.gen(function* () {
    const processor = yield* MediaProcessor;
    const storage = yield* Storage;
    return {
      result: yield* Effect.result(processor.process(assetId, file)),
      persisted: yield* storage.exists(assetId),
    };
  }).pipe(Effect.provide(layer));

afterEach(async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* Storage;
      yield* Effect.all(assetIds.map((assetId) => storage.removeAssetDir(assetId)));
    }).pipe(Effect.provide(storageLayer)),
  );
});

describe("MediaProcessor image processing", () => {
  test.each([
    ["JPEG", "image-jpeg", jpeg, "wrong.png", "image/png", "original.jpg"],
    ["PNG", "image-png", png, "photo.jpeg", "image/jpeg", "original.png"],
    ["WebP", "image-webp", webp, "photo.png", "image/png", "original.webp"],
  ])(
    "stores valid %s bytes using their detected format",
    async (_, assetId, source, name, type, filename) => {
      const result = await Effect.runPromise(process(assetId, new File([source], name, { type })));

      expect(result.processed).toMatchObject({ kind: "image", durationSec: 0, filename });
      expect(result.processed.width).toBeGreaterThan(0);
      expect(result.processed.height).toBeGreaterThan(0);
      expect(result.stored).toEqual(source);
      expect(result.hasHls).toBe(false);
    },
  );

  test.each([
    ["SVG", "image-svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["GIF", "image-gif", new TextEncoder().encode("GIF89a")],
  ])("rejects unsupported %s images", async (_, assetId, source) => {
    const outcome = await Effect.runPromise(
      processEither(assetId, new File([source], "image", { type: "image/*" })),
    );

    expect(Result.isFailure(outcome.result)).toBe(true);
    if (Result.isFailure(outcome.result)) {
      expect(outcome.result.failure).toBeInstanceOf(UnsupportedMediaError);
      expect("cause" in outcome.result.failure).toBe(false);
    }
    expect(outcome.persisted).toBe(false);
  });

  test("rejects unsupported headers without reading the full file", async () => {
    class HeaderOnlyFile extends File {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject(new Error("full file read"));
      }
    }

    const outcome = await Effect.runPromise(
      processEither(
        "image-header-only-gif",
        new HeaderOnlyFile([new TextEncoder().encode("GIF89a")], "animated.gif"),
      ),
    );

    expect(Result.isFailure(outcome.result)).toBe(true);
    if (Result.isFailure(outcome.result)) {
      expect(outcome.result.failure).toBeInstanceOf(UnsupportedMediaError);
    }
    expect(outcome.persisted).toBe(false);
  });

  test.each([
    ["JPEG", "image-corrupt-jpeg", Uint8Array.of(0xff, 0xd8, 0xff), "bad.jpg", "image/jpeg"],
    [
      "PNG",
      "image-corrupt-png",
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      "bad.png",
      "image/png",
    ],
    [
      "WebP",
      "image-corrupt-webp",
      new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBP"),
      "bad.webp",
      "image/webp",
    ],
  ])("rejects a corrupt %s signature", async (_, assetId, source, name, type) => {
    const outcome = await Effect.runPromise(
      processEither(assetId, new File([source], name, { type })),
    );

    expect(Result.isFailure(outcome.result)).toBe(true);
    if (Result.isFailure(outcome.result)) {
      expect(outcome.result.failure).toBeInstanceOf(InvalidImageError);
      expect("cause" in outcome.result.failure).toBe(false);
    }
    expect(outcome.persisted).toBe(false);
  });
});

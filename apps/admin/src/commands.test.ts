import { Effect } from "effect";
import { expect, test } from "vitest";
import { LoadVideos } from "./commands";

test("maps network rejection to FailedLoadVideos", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(() => Promise.reject(new Error("Network unavailable")), {
    preconnect: originalFetch.preconnect,
  });

  try {
    const result = await Effect.runPromise(LoadVideos().effect);

    expect(result).toEqual({ _tag: "FailedLoadVideos", error: "Network unavailable" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps invalid JSON to FailedLoadVideos", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(() => Promise.resolve(new Response("not json")), {
    preconnect: originalFetch.preconnect,
  });

  try {
    const result = await Effect.runPromise(LoadVideos().effect);

    expect(result._tag).toBe("FailedLoadVideos");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

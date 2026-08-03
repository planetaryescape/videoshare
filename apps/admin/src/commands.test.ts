import { Effect } from "effect";
import { expect, test } from "vitest";
import { CHAPTER_PLAYER_ID, currentChapterStartSec } from "./chapterPlayback";
import { GenerateChapterId, LoadVideos } from "./commands";

test("reads the current review playback second", () => {
  const player = document.createElement("video");
  player.id = CHAPTER_PLAYER_ID;
  Object.defineProperty(player, "currentTime", { value: 42.9 });
  document.body.append(player);

  try {
    expect(currentChapterStartSec()).toBe(42);
  } finally {
    player.remove();
  }
});

test("retains the chapter timestamp captured at click time", async () => {
  const result = await Effect.runPromise(
    GenerateChapterId({ videoId: "video-1", startSec: 42 }).effect,
  );

  expect(result).toMatchObject({
    _tag: "GeneratedChapterId",
    videoId: "video-1",
    startSec: 42,
  });
});

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

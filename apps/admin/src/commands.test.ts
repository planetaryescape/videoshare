import { Effect, Option } from "effect";
import { expect, test } from "vitest";
import { CHAPTER_PLAYER_ID, currentChapterStartSec } from "./chapterPlayback";
import { GenerateChapterId, LoadAssets, LoadProject, SaveProject } from "./commands";

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
    GenerateChapterId({ assetId: "video-1", startSec: 42 }).effect,
  );

  expect(result).toMatchObject({
    _tag: "GeneratedChapterId",
    assetId: "video-1",
    startSec: 42,
  });
});

test("maps network rejection to FailedLoadAssets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(() => Promise.reject(new Error("Network unavailable")), {
    preconnect: originalFetch.preconnect,
  });

  try {
    const result = await Effect.runPromise(LoadAssets().effect);

    expect(result).toEqual({ _tag: "FailedLoadAssets", error: "Network unavailable" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const projectDetail = {
  project: {
    id: "project-1",
    slug: "project",
    title: "Project",
    description: null,
    createdAt: 1,
    publishedAt: null,
    updatedAt: null,
  },
  assets: [],
};

const saveProjectBody = async (password: Option.Option<string>) => {
  const originalFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body);
      return Promise.resolve(Response.json(projectDetail));
    },
    { preconnect: originalFetch.preconnect },
  );

  try {
    const result = await Effect.runPromise(
      SaveProject({ requestId: 1, id: "project-1", title: "Renamed", description: "", password })
        .effect,
    );
    expect(result._tag).toBe("SucceededSaveProject");
    return JSON.parse(body);
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("omits an untouched project password", async () => {
  expect(await saveProjectBody(Option.none())).toEqual({ title: "Renamed", description: "" });
});

test("sends an explicitly cleared project password", async () => {
  expect(await saveProjectBody(Option.some(""))).toEqual({
    title: "Renamed",
    description: "",
    password: "",
  });
});

test("carries the requested project ID through a load failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(() => Promise.reject(new Error("Network unavailable")), {
    preconnect: originalFetch.preconnect,
  });

  try {
    const result = await Effect.runPromise(LoadProject({ id: "project-1" }).effect);

    expect(result).toEqual({
      _tag: "FailedLoadProject",
      id: "project-1",
      error: "Network unavailable",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps invalid JSON to FailedLoadAssets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(() => Promise.resolve(new Response("not json")), {
    preconnect: originalFetch.preconnect,
  });

  try {
    const result = await Effect.runPromise(LoadAssets().effect);

    expect(result._tag).toBe("FailedLoadAssets");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

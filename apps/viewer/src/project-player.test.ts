import { describe, expect, test } from "bun:test";
import {
  isTimedKind,
  stateForProjectPath,
  stateForRoute,
  statesEqual,
  summary,
  transition,
  viewing,
} from "./project-player.ts";

const members = 3;

describe("ProjectPlayer", () => {
  test("starts at root position zero and restores deep links or summary", () => {
    expect(stateForRoute(null, ["a", "b"])).toEqual(viewing());
    expect(stateForRoute("b", ["a", "b"])).toEqual(viewing(1));
    expect(stateForRoute("summary", ["a", "b"])).toEqual(summary);
    expect(stateForRoute("missing", ["a", "b"])).toBeNull();
    expect(stateForRoute(null, [])).toEqual(summary);
  });

  test("select, previous, next, summary previous, and restart are bounded", () => {
    expect(transition(viewing(), { _tag: "Select", index: 1 }, members)).toEqual(viewing(1));
    expect(transition(viewing(), { _tag: "Select", index: 9 }, members)).toEqual(viewing());
    expect(transition(viewing(), { _tag: "Previous" }, members)).toEqual(viewing());
    expect(transition(viewing(2), { _tag: "Next" }, members)).toEqual(summary);
    expect(transition(summary, { _tag: "Previous" }, members)).toEqual(viewing(2));
    expect(transition(summary, { _tag: "Next" }, members)).toEqual(viewing());
    expect(transition(summary, { _tag: "Restart" }, members)).toEqual(viewing());
  });

  test("returns from Summary through previous then next controls", () => {
    const previous = transition(summary, { _tag: "Previous" }, members);
    expect(previous).toEqual(viewing(2));
    expect(transition(previous, { _tag: "Next" }, members)).toEqual(summary);
  });

  test("recognizes only audio and video as timed kinds", () => {
    expect(isTimedKind("audio")).toBe(true);
    expect(isTimedKind("video")).toBe(true);
    expect(isTimedKind("image")).toBe(false);
    expect(isTimedKind("markdown")).toBe(false);
    expect(isTimedKind("document")).toBe(false);
    expect(isTimedKind(undefined)).toBe(false);
  });

  test("only timed ended events advance", () => {
    expect(transition(viewing(), { _tag: "Ended", isTimed: false }, members)).toEqual(viewing());
    expect(transition(viewing(1), { _tag: "Ended", isTimed: false }, members)).toEqual(viewing(1));
    expect(transition(viewing(1), { _tag: "Ended", isTimed: true }, members)).toEqual(viewing(2));
    expect(transition(viewing(2), { _tag: "Ended", isTimed: true }, members)).toEqual(summary);
  });

  test("pause, seek, and time updates are idempotent", () => {
    expect(transition(viewing(1), { _tag: "Pause" }, members)).toEqual(viewing(1));
    expect(transition(summary, { _tag: "Pause" }, members)).toEqual(summary);
    expect(transition(viewing(1), { _tag: "Seek" }, members)).toEqual(viewing(1));
    expect(transition(summary, { _tag: "Seek" }, members)).toEqual(summary);
    expect(transition(viewing(1), { _tag: "TimeUpdate" }, members)).toEqual(viewing(1));
    expect(transition(summary, { _tag: "TimeUpdate" }, members)).toEqual(summary);
  });

  test("state equality suppresses duplicate navigation and invalid popstate has no state", () => {
    expect(statesEqual(viewing(1), viewing(1))).toBe(true);
    expect(statesEqual(summary, summary)).toBe(true);
    expect(statesEqual(viewing(), summary)).toBe(false);
    expect(stateForRoute("not-a-member", ["a", "b"])).toBeNull();
    expect(stateForProjectPath("/p/show/not-a-member", "show", ["a", "b"])).toBeNull();
    expect(stateForProjectPath("/p/another-project/a", "show", ["a", "b"])).toBeNull();
    expect(stateForProjectPath("/p/show/media/a/segment.ts", "show", ["a", "b"])).toBeNull();
    expect(stateForProjectPath("/p//show/a", "show", ["a", "b"])).toBeNull();
    expect(stateForProjectPath("/p/show//a", "show", ["a", "b"])).toBeNull();
    expect(stateForProjectPath("/p/show/a/", "show", ["a", "b"])).toEqual(viewing());
  });
});

import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  chapterRowError,
  chaptersValidationError,
  clampToDuration,
  duplicateStartSecs,
  formatTimestamp,
  parseTimestamp,
  sortChapters,
} from "./chapters";
import type { Chapter } from "./model";

const chapter = (id: string, startSec: number, title = "Titled"): Chapter => ({
  id,
  assetId: "video-1",
  title,
  startSec,
  sortOrder: 0,
});

describe("formatTimestamp", () => {
  test("pads seconds and drops the hour when unused", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(4)).toBe("0:04");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });
});

describe("parseTimestamp", () => {
  test("accepts seconds, m:ss, and h:mm:ss", () => {
    expect(parseTimestamp("42")).toEqual(Option.some(42));
    expect(parseTimestamp("1:05")).toEqual(Option.some(65));
    expect(parseTimestamp("1:02:05")).toEqual(Option.some(3725));
    expect(parseTimestamp("  0:04 ")).toEqual(Option.some(4));
  });

  test("rejects malformed input", () => {
    expect(parseTimestamp("")).toEqual(Option.none());
    expect(parseTimestamp("abc")).toEqual(Option.none());
    expect(parseTimestamp("1:60")).toEqual(Option.none());
    expect(parseTimestamp("1:2:3:4")).toEqual(Option.none());
    expect(parseTimestamp("-5")).toEqual(Option.none());
    expect(parseTimestamp("9".repeat(400))).toEqual(Option.none());
  });
});

describe("clampToDuration", () => {
  test("clamps to a known duration", () => {
    expect(clampToDuration(200, 125)).toBe(125);
    expect(clampToDuration(60, 125)).toBe(60);
  });

  test("leaves timestamps alone before the duration is known", () => {
    expect(clampToDuration(42, 0)).toBe(42);
  });
});

describe("sortChapters", () => {
  test("orders by start time and renumbers sortOrder", () => {
    const sorted = sortChapters([chapter("b", 65), chapter("a", 4), chapter("c", 130)]);

    expect(sorted.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(sorted.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });

  test("keeps ties in their existing order", () => {
    const sorted = sortChapters([chapter("first", 4), chapter("second", 4)]);

    expect(sorted.map((c) => c.id)).toEqual(["first", "second"]);
  });
});

describe("validation", () => {
  test("reports duplicate start times", () => {
    expect(duplicateStartSecs([chapter("a", 4), chapter("b", 4), chapter("c", 9)])).toEqual(
      new Set([4]),
    );
  });

  test("reports every invalid condition on a row", () => {
    expect(chapterRowError(chapter("a", 4, ""), new Set([4]))).toEqual(
      Option.some("Needs a title. Another chapter already starts at 0:04"),
    );
  });

  test("blocks saving on duplicates and on missing titles", () => {
    expect(chaptersValidationError([chapter("a", 4), chapter("b", 4)])).toEqual(
      Option.some("Two chapters share a timestamp. Change one before saving."),
    );
    expect(chaptersValidationError([chapter("a", 4, "")])).toEqual(
      Option.some("Every chapter needs a title before saving"),
    );
    expect(chaptersValidationError([chapter("a", 4), chapter("b", 9)])).toEqual(Option.none());
  });
});

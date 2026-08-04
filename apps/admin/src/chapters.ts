import { Option } from "effect";
import type { Chapter } from "./model";

export const formatTimestamp = (sec: number): string => {
  const whole = Math.max(0, Math.floor(sec));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? minutes.toString().padStart(2, "0") : minutes.toString();
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${seconds.toString().padStart(2, "0")}`;
};

/** Accepts `ss`, `m:ss`, or `h:mm:ss`. Colon-separated parts after the first must be 0-59. */
export const parseTimestamp = (raw: string): Option.Option<number> => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return Option.none();
  }

  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return Option.none();
  }

  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part > 59)) {
    return Option.none();
  }

  const seconds = numbers.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) ? Option.some(seconds) : Option.none();
};

/** A durationSec of 0 means "not transcoded yet", so it must not clamp timestamps to zero. */
export const clampToDuration = (sec: number, durationSec: number): number => {
  const floored = Math.max(0, Math.floor(sec));
  return durationSec > 0 ? Math.min(floored, Math.floor(durationSec)) : floored;
};

/**
 * Order is derived from startSec, so sortOrder is always reassigned to match.
 * Ties keep their existing relative order so a duplicate row does not jump while
 * the author is still fixing it.
 */
export const sortChapters = (chapters: ReadonlyArray<Chapter>): ReadonlyArray<Chapter> =>
  chapters
    .map((chapter, index) => ({ chapter, index }))
    .toSorted((a, b) =>
      a.chapter.startSec === b.chapter.startSec
        ? a.index - b.index
        : a.chapter.startSec - b.chapter.startSec,
    )
    .map(({ chapter }, sortOrder) =>
      chapter.sortOrder === sortOrder ? chapter : { ...chapter, sortOrder },
    );

export const duplicateStartSecs = (chapters: ReadonlyArray<Chapter>): ReadonlySet<number> => {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const chapter of chapters) {
    if (seen.has(chapter.startSec)) {
      duplicates.add(chapter.startSec);
    }
    seen.add(chapter.startSec);
  }
  return duplicates;
};

export const chapterRowError = (
  chapter: Chapter,
  duplicates: ReadonlySet<number>,
): Option.Option<string> => {
  const errors = [
    ...(chapter.title.trim() === "" ? ["Needs a title"] : []),
    ...(duplicates.has(chapter.startSec)
      ? [`Another chapter already starts at ${formatTimestamp(chapter.startSec)}`]
      : []),
  ];
  return errors.length > 0 ? Option.some(errors.join(". ")) : Option.none();
};

export const chaptersValidationError = (
  chapters: ReadonlyArray<Chapter>,
): Option.Option<string> => {
  if (duplicateStartSecs(chapters).size > 0) {
    return Option.some("Two chapters share a timestamp. Change one before saving.");
  }
  if (chapters.some((chapter) => chapter.title.trim() === "")) {
    return Option.some("Every chapter needs a title before saving");
  }
  return Option.none();
};

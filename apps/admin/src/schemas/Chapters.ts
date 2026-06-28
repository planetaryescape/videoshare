import { Chapter, ChapterId } from "@videoshare/shared/Video";
import type { VideoId } from "@videoshare/shared/Video";
import type { ChapterInput } from "../schemas/Requests.ts";

export const chaptersFromInput = (
  videoId: VideoId,
  input: ReadonlyArray<ChapterInput>,
): ReadonlyArray<Chapter> =>
  input.map(
    (ch, index) =>
      new Chapter({
        id: ChapterId.make(ch.id ?? crypto.randomUUID()),
        videoId,
        title: ch.title,
        startSec: ch.startSec,
        sortOrder: index,
      }),
  );

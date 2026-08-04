import { Chapter, ChapterId } from "@videoshare/shared/Asset";
import type { AssetId } from "@videoshare/shared/Asset";
import type { ChapterInput } from "../schemas/Requests.ts";

export const chaptersFromInput = (
  assetId: AssetId,
  input: ReadonlyArray<ChapterInput>,
): ReadonlyArray<Chapter> =>
  input.map(
    (ch, index) =>
      new Chapter({
        id: ChapterId.make(ch.id ?? crypto.randomUUID()),
        assetId,
        title: ch.title,
        startSec: ch.startSec,
        sortOrder: index,
      }),
  );

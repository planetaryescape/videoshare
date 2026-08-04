import { Option } from "effect";
import { Button, Input } from "@foldkit/ui";
import type { html } from "foldkit/html";
import { chapterRowError, formatTimestamp } from "../chapters";
import type { Chapter } from "../model";
import {
  BlurredChapterField,
  ClickedRemoveChapter,
  ClickedSetChapterToPlayhead,
  CommittedChapterStart,
  type Message,
  UpdatedChapterStart,
  UpdatedChapterTitle,
} from "../message";

type Html = ReturnType<typeof html<Message>>;

const inputClass = (isInvalid: boolean) =>
  `w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 ${
    isInvalid
      ? "border-red-600 focus:border-red-500 focus:ring-red-500"
      : "border-gray-700 focus:border-blue-500 focus:ring-blue-500"
  }`;

const startField = (h: Html, chapter: Chapter, draft: string | undefined, isInvalid: boolean) =>
  Input.view<Message>({
    id: `chapter-${chapter.id}-start`,
    value: draft ?? formatTimestamp(chapter.startSec),
    placeholder: "0:00",
    isInvalid,
    onInput: (value) => UpdatedChapterStart({ id: chapter.id, value }),
    toView: ({ input, label, description }) =>
      h.div(
        [h.Class("shrink-0")],
        [
          h.label([...label, h.Class("sr-only")], ["Start time"]),
          h.input([
            ...input,
            h.OnBlur(CommittedChapterStart({ id: chapter.id })),
            h.OnKeyDownPreventDefault((key) =>
              key === "Enter"
                ? Option.some(CommittedChapterStart({ id: chapter.id }))
                : Option.none(),
            ),
            h.Class(`${inputClass(isInvalid)} w-20 text-center font-mono tabular-nums`),
          ]),
          h.span([...description, h.Class("sr-only")], ["Start time as m:ss or h:mm:ss"]),
        ],
      ),
  });

const playheadButton = (h: Html, chapter: Chapter) =>
  Button.view<Message>({
    onClick: ClickedSetChapterToPlayhead({ id: chapter.id }),
    toView: ({ button }) =>
      h.button(
        [
          ...button,
          h.Title("Set to current playback position"),
          h.AriaLabel(
            `Set start time of ${chapter.title.trim() || "untitled chapter"} to the playhead`,
          ),
          h.Class(
            "flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
          ),
        ],
        [
          h.svg(
            [
              h.Class("h-4 w-4"),
              h.ViewBox("0 0 24 24"),
              h.Fill("none"),
              h.Stroke("currentColor"),
              h.StrokeWidth("2"),
              h.AriaHidden(true),
            ],
            [
              h.circle([h.Cx("12"), h.Cy("12"), h.R("3")], []),
              h.path([h.D("M12 2v4M12 18v4M2 12h4M18 12h4")], []),
            ],
          ),
        ],
      ),
  });

const titleField = (h: Html, chapter: Chapter, isInvalid: boolean) =>
  Input.view<Message>({
    id: `chapter-${chapter.id}-title`,
    value: chapter.title,
    placeholder: "Chapter title",
    isInvalid,
    onInput: (value) => UpdatedChapterTitle({ id: chapter.id, title: value }),
    toView: ({ input, label, description }) =>
      h.div(
        [h.Class("flex-1")],
        [
          h.label([...label, h.Class("sr-only")], ["Chapter title"]),
          h.input([...input, h.OnBlur(BlurredChapterField()), h.Class(inputClass(isInvalid))]),
          h.span([...description, h.Class("sr-only")], ["Chapter title"]),
        ],
      ),
  });

const removeButton = (h: Html, chapter: Chapter) =>
  Button.view<Message>({
    onClick: ClickedRemoveChapter({ id: chapter.id }),
    toView: ({ button }) =>
      h.button(
        [
          ...button,
          h.Title("Remove chapter"),
          h.AriaLabel(
            chapter.title.trim() === ""
              ? "Remove untitled chapter"
              : `Remove chapter ${chapter.title}`,
          ),
          h.Class(
            "flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-900/50 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400",
          ),
        ],
        [
          h.svg(
            [
              h.Class("h-4 w-4"),
              h.ViewBox("0 0 24 24"),
              h.Fill("none"),
              h.Stroke("currentColor"),
              h.StrokeWidth("2"),
              h.AriaHidden(true),
            ],
            [h.path([h.D("M6 6l12 12M18 6L6 18")], [])],
          ),
        ],
      ),
  });

export const chapterRow = (
  h: Html,
  chapter: Chapter,
  draft: string | undefined,
  duplicates: ReadonlySet<number>,
) => {
  const rowError = chapterRowError(chapter, duplicates);
  const isDuplicate = duplicates.has(chapter.startSec);

  return h.keyed("li")(
    chapter.id,
    [h.Class("chapter-row list-none")],
    [
      h.div(
        [h.Class("flex items-start gap-2")],
        [
          startField(h, chapter, draft, isDuplicate),
          playheadButton(h, chapter),
          titleField(h, chapter, chapter.title.trim() === ""),
          removeButton(h, chapter),
        ],
      ),
      ...(Option.isSome(rowError)
        ? [h.p([h.Class("mt-1 pl-1 text-xs text-red-300"), h.Role("alert")], [rowError.value])]
        : []),
    ],
  );
};

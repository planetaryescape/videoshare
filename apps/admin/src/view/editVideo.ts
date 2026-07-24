import { Option } from "effect";
import { Button, FileDrop, Input, Textarea } from "@foldkit/ui";
import type { html } from "foldkit/html";
import {
  formatDate,
  formatDuration,
  hasUnpublishedChanges,
  isPublished,
  shareUrl,
  type Model,
} from "../model";
import {
  BlurredChapterField,
  BlurredEditField,
  ClearedPoster,
  ClickedAddChapter,
  ClickedBack,
  ClickedCopyLink,
  ClickedPublish,
  ClickedRemoveChapter,
  ClickedUnpublish,
  GotPosterFileDropMessage,
  GotVideoFileDropMessage,
  type Message,
  SubmittedUpload,
  UpdatedChapterStart,
  UpdatedChapterTitle,
  UpdatedDescription,
  UpdatedTitle,
} from "../message";

type Html = ReturnType<typeof html<Message>>;

const stageLabel = (stage: string): string => {
  if (stage === "uploading") return "Uploading file...";
  if (stage === "transcoding") return "Transcoding";
  if (stage === "poster") return "Generating poster...";
  if (stage === "uploading-media") return "Uploading to R2...";
  if (stage === "done") return "Done";
  return "Working...";
};

const uploadProgress = (h: Html, model: Model) => {
  const indeterminate = model.uploadStage === "uploading" || model.uploadStage === "";
  const width = indeterminate ? 100 : model.uploadPct;
  return h.div(
    [h.Class("mt-4")],
    [
      h.div(
        [
          h.AriaAtomic(true),
          h.AriaLive("polite"),
          h.Class("mb-1 flex justify-between text-xs text-gray-400"),
        ],
        [stageLabel(model.uploadStage), indeterminate ? "" : `${model.uploadPct}%`],
      ),
      h.div(
        [
          h.Role("progressbar"),
          h.AriaLabel("Upload and transcode progress"),
          h.AriaValuemin(0),
          h.AriaValuemax(100),
          ...(indeterminate
            ? []
            : [h.AriaValuenow(model.uploadPct), h.AriaValuetext(`${model.uploadPct}%`)]),
          h.Class("h-2 w-full overflow-hidden rounded-full bg-gray-700"),
        ],
        [
          h.div(
            [
              h.Class(
                `h-full rounded-full bg-blue-500 transition-all duration-300 ${
                  indeterminate ? "animate-pulse" : ""
                }`,
              ),
              h.Style({ width: `${width}%` }),
            ],
            [],
          ),
        ],
      ),
    ],
  );
};

const chaptersSection = (h: Html, model: Model) =>
  h.div(
    [h.Class("rounded-lg border border-gray-800 bg-gray-900/50 p-4")],
    [
      h.div(
        [h.Class("mb-3 flex items-center justify-between")],
        [
          h.label([h.Class("text-sm font-medium text-gray-300")], ["Chapters"]),
          Button.view<Message>({
            onClick: ClickedAddChapter(),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.Class(
                    "rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-600 transition-colors",
                  ),
                ],
                ["+ Add chapter"],
              ),
          }),
        ],
      ),
      ...(model.editChapters.length === 0
        ? [h.p([h.Class("text-sm text-gray-500")], ["No chapters yet."])]
        : model.editChapters.map((chapter) =>
            h.keyed("div")(
              chapter.id,
              [h.Class("mb-2 flex items-center gap-2")],
              [
                Input.view<Message>({
                  id: `chapter-${chapter.id}-start`,
                  value: String(chapter.startSec),
                  type: "number",
                  placeholder: "sec",
                  onInput: (value) =>
                    UpdatedChapterStart({ id: chapter.id, startSec: Number(value) || 0 }),
                  toView: ({ input, label, description }) =>
                    h.div(
                      [h.Class("w-24")],
                      [
                        h.label([...label, h.Class("sr-only")], ["Chapter start time"]),
                        h.input([
                          ...input,
                          h.Min("0"),
                          h.OnBlur(BlurredChapterField()),
                          h.Class(
                            "w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                          ),
                        ]),
                        h.span([...description, h.Class("sr-only")], ["Start time in seconds"]),
                      ],
                    ),
                }),
                Input.view<Message>({
                  id: `chapter-${chapter.id}-title`,
                  value: chapter.title,
                  placeholder: "Chapter title",
                  isInvalid: chapter.title.trim() === "",
                  onInput: (value) => UpdatedChapterTitle({ id: chapter.id, title: value }),
                  toView: ({ input, label, description }) =>
                    h.div(
                      [h.Class("flex-1")],
                      [
                        h.label([...label, h.Class("sr-only")], ["Chapter title"]),
                        h.input([
                          ...input,
                          h.OnBlur(BlurredChapterField()),
                          h.Class(
                            "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                          ),
                        ]),
                        h.span([...description, h.Class("sr-only")], ["Chapter title"]),
                      ],
                    ),
                }),
                Button.view<Message>({
                  onClick: ClickedRemoveChapter({ id: chapter.id }),
                  toView: ({ button }) =>
                    h.button(
                      [
                        ...button,
                        h.AriaLabel(
                          chapter.title.trim() === ""
                            ? "Remove untitled chapter"
                            : `Remove chapter ${chapter.title}`,
                        ),
                        h.Class(
                          "rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:bg-red-900/50 hover:text-red-300 transition-colors",
                        ),
                      ],
                      ["✕"],
                    ),
                }),
              ],
            ),
          )),
      ...(Option.isSome(model.chapterValidationError)
        ? [
            h.p(
              [h.Role("alert"), h.Class("mt-2 text-sm text-red-300")],
              [model.chapterValidationError.value],
            ),
          ]
        : []),
    ],
  );

export const editVideoView = (h: Html, model: Model) => {
  const video = Option.isSome(model.editVideo) ? model.editVideo.value : null;

  return h.div(
    [h.Class("mx-auto max-w-2xl")],
    [
      Button.view<Message>({
        onClick: ClickedBack(),
        toView: ({ button }) =>
          h.button(
            [
              ...button,
              h.Class(
                "mb-6 flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors",
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
                ],
                [h.path([h.D("M15 19l-7-7 7-7")], [])],
              ),
              " Back to videos",
            ],
          ),
      }),
      h.h1([h.Class("mb-8 text-2xl font-bold text-white")], [video ? video.title : "New Video"]),
      ...(Option.isSome(model.errorMessage)
        ? [
            h.div(
              [
                h.Role("alert"),
                h.Class(
                  "mb-4 rounded-lg bg-red-900/50 border border-red-700 px-4 py-3 text-sm text-red-200",
                ),
              ],
              [model.errorMessage.value],
            ),
          ]
        : []),
      h.div(
        [h.Class("space-y-6")],
        [
          h.div(
            [],
            [
              Input.view<Message>({
                id: "video-title",
                value: model.editTitle,
                placeholder: "Video title",
                onInput: (value) => UpdatedTitle({ title: value }),
                toView: ({ input, label, description }) =>
                  h.div(
                    [],
                    [
                      h.label(
                        [...label, h.Class("block text-sm font-medium text-gray-300 mb-1")],
                        ["Title"],
                      ),
                      h.input([
                        ...input,
                        h.OnBlur(BlurredEditField()),
                        h.Class(
                          "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                        ),
                      ]),
                      h.span([...description, h.Class("sr-only")], ["Video title"]),
                    ],
                  ),
              }),
            ],
          ),
          h.div(
            [],
            [
              Textarea.view<Message>({
                id: "video-description",
                value: model.editDescription,
                rows: 3,
                placeholder: "Video description",
                onInput: (value) => UpdatedDescription({ description: value }),
                toView: ({ textarea, label, description }) =>
                  h.div(
                    [],
                    [
                      h.label(
                        [...label, h.Class("block text-sm font-medium text-gray-300 mb-1")],
                        ["Description"],
                      ),
                      h.textarea(
                        [
                          ...textarea,
                          h.OnBlur(BlurredEditField()),
                          h.Class(
                            "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                          ),
                        ],
                        [],
                      ),
                      h.span([...description, h.Class("sr-only")], ["Optional video description"]),
                    ],
                  ),
              }),
            ],
          ),
          ...(video?.posterKey
            ? [
                h.div(
                  [],
                  [
                    h.label([h.Class("block text-sm font-medium text-gray-300 mb-1")], ["Poster"]),
                    h.img([
                      h.Src(`/${video.posterKey}`),
                      h.Alt(`Poster for ${video.title}`),
                      h.Class("w-full max-w-sm rounded-lg border border-gray-700"),
                    ]),
                  ],
                ),
              ]
            : []),
          ...(!video || !video.hlsKey
            ? [
                h.div(
                  [h.Class("rounded-lg border border-dashed border-gray-600 bg-gray-900/50 p-6")],
                  [
                    h.label(
                      [h.Class("block text-sm font-medium text-gray-300 mb-3")],
                      ["Upload video or audio mix"],
                    ),
                    h.submodel({
                      slotId: model.videoFileDrop.id,
                      model: model.videoFileDrop,
                      view: FileDrop.view,
                      viewInputs: {
                        accept: [".mp4", "video/mp4", ".mp3", ".m4a", ".aac", ".flac", "audio/*"],
                        isDisabled: model.isUploading,
                        toView: ({ root, input }) =>
                          h.label(
                            [
                              ...root,
                              h.Class(
                                "block cursor-pointer rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-sm text-gray-300 transition-colors hover:border-gray-600 data-[drag-over]:border-blue-500 data-[drag-over]:bg-blue-950/30",
                              ),
                            ],
                            ["Drop a file here or click to browse", h.input(input)],
                          ),
                      },
                      toParentMessage: (message) => GotVideoFileDropMessage({ message }),
                    }),
                    ...(Option.isSome(model.selectedFile)
                      ? [
                          h.div(
                            [h.Class("mt-3 text-sm text-gray-300")],
                            [
                              "Selected: ",
                              h.span(
                                [h.Class("font-medium text-white")],
                                [model.selectedFile.value.name],
                              ),
                            ],
                          ),
                        ]
                      : []),
                    h.label(
                      [h.Class("mt-4 block text-sm font-medium text-gray-300 mb-3")],
                      ["Cover image (optional)"],
                    ),
                    h.submodel({
                      slotId: model.posterFileDrop.id,
                      model: model.posterFileDrop,
                      view: FileDrop.view,
                      viewInputs: {
                        accept: ["image/*"],
                        isDisabled: model.isUploading,
                        toView: ({ root, input }) =>
                          h.label(
                            [
                              ...root,
                              h.Class(
                                "block cursor-pointer rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-sm text-gray-300 transition-colors hover:border-gray-600 data-[drag-over]:border-blue-500 data-[drag-over]:bg-blue-950/30",
                              ),
                            ],
                            ["Drop an image here or click to browse", h.input(input)],
                          ),
                      },
                      toParentMessage: (message) => GotPosterFileDropMessage({ message }),
                    }),
                    ...(Option.isSome(model.selectedPoster)
                      ? [
                          h.div(
                            [h.Class("mt-3 flex items-center gap-2 text-sm text-gray-300")],
                            [
                              "Cover: ",
                              h.span(
                                [h.Class("font-medium text-white")],
                                [model.selectedPoster.value.name],
                              ),
                              Button.view<Message>({
                                onClick: ClearedPoster(),
                                toView: ({ button }) =>
                                  h.button(
                                    [
                                      ...button,
                                      h.Class(
                                        "ml-1 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-red-900/50 hover:text-red-300 transition-colors",
                                      ),
                                    ],
                                    ["Remove"],
                                  ),
                              }),
                            ],
                          ),
                        ]
                      : []),
                    Button.view<Message>({
                      onClick: SubmittedUpload(),
                      isDisabled: model.isUploading || Option.isNone(model.selectedFile),
                      toView: ({ button }) =>
                        h.button(
                          [
                            ...button,
                            h.Class(
                              "mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:not-data-[disabled]:bg-blue-500 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                            ),
                          ],
                          [model.isUploading ? "Uploading & Transcoding..." : "Upload & Transcode"],
                        ),
                    }),
                    ...(model.isUploading ? [uploadProgress(h, model)] : []),
                  ],
                ),
              ]
            : []),
          ...(video?.hlsKey
            ? [
                h.div(
                  [h.Class("space-y-3")],
                  [
                    ...(isPublished(video) && hasUnpublishedChanges(video)
                      ? [
                          h.div(
                            [
                              h.Class(
                                "flex items-center gap-2 rounded-lg bg-amber-900/40 border border-amber-700/60 px-3 py-2 text-sm text-amber-200",
                              ),
                            ],
                            [
                              h.span([h.AriaHidden(true), h.Class("text-amber-400")], ["●"]),
                              "Local changes are not live yet. Republish to update.",
                            ],
                          ),
                        ]
                      : []),
                    h.div(
                      [h.Class("flex gap-3")],
                      [
                        Button.view<Message>({
                          onClick: ClickedPublish({ id: video.id }),
                          isDisabled: model.isPublishing,
                          toView: ({ button }) =>
                            h.button(
                              [
                                ...button,
                                h.Class(
                                  "rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:not-data-[disabled]:bg-green-500 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                                ),
                              ],
                              [
                                model.isPublishing
                                  ? "Publishing..."
                                  : isPublished(video)
                                    ? "Republish"
                                    : "Publish",
                              ],
                            ),
                        }),
                        ...(isPublished(video)
                          ? [
                              Button.view<Message>({
                                onClick: ClickedUnpublish({ id: video.id }),
                                isDisabled: model.isUnpublishing,
                                toView: ({ button }) =>
                                  h.button(
                                    [
                                      ...button,
                                      h.Class(
                                        "rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:not-data-[disabled]:bg-amber-600 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                                      ),
                                    ],
                                    [model.isUnpublishing ? "Unpublishing..." : "Unpublish"],
                                  ),
                              }),
                            ]
                          : []),
                        Button.view<Message>({
                          onClick: ClickedCopyLink({ url: shareUrl(video.slug) }),
                          toView: ({ button }) =>
                            h.button(
                              [
                                ...button,
                                h.Class(
                                  "rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 transition-colors",
                                ),
                              ],
                              [model.copiedLink ? "Copied!" : "Copy link"],
                            ),
                        }),
                      ],
                    ),
                  ],
                ),
              ]
            : []),
          ...(video ? [chaptersSection(h, model)] : []),
          ...(video
            ? [
                h.div(
                  [h.Class("pt-4 border-t border-gray-800 text-xs text-gray-500 space-y-1")],
                  [
                    h.div(
                      [],
                      ["Slug: ", h.span([h.Class("font-mono text-gray-400")], [video.slug])],
                    ),
                    h.div([], ["ID: ", h.span([h.Class("font-mono text-gray-400")], [video.id])]),
                    h.div(
                      [],
                      [
                        "Duration: ",
                        h.span([h.Class("text-gray-400")], [formatDuration(video.durationSec)]),
                      ],
                    ),
                    h.div(
                      [],
                      [
                        "Created: ",
                        h.span([h.Class("text-gray-400")], [formatDate(video.createdAt)]),
                      ],
                    ),
                    ...(video.publishedAt
                      ? [
                          h.div(
                            [],
                            [
                              "Published: ",
                              h.span([h.Class("text-gray-400")], [formatDate(video.publishedAt)]),
                            ],
                          ),
                        ]
                      : []),
                  ],
                ),
              ]
            : []),
        ],
      ),
    ],
  );
};

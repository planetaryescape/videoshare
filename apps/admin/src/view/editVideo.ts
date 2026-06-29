import { Option } from "effect";
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
  ClickedAddChapter,
  ClickedBack,
  ClickedCopyLink,
  ClickedPublish,
  ClickedRemoveChapter,
  ClickedUnpublish,
  type Message,
  SelectedFile,
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
        [h.Class("mb-1 flex justify-between text-xs text-gray-400")],
        [
          stageLabel(model.uploadStage),
          indeterminate ? "" : `${model.uploadPct}%`,
        ],
      ),
      h.div(
        [h.Class("h-2 w-full overflow-hidden rounded-full bg-gray-700")],
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
          h.button(
            [
              h.Class(
                "rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-600 transition-colors",
              ),
              h.OnClick(ClickedAddChapter()),
            ],
            ["+ Add chapter"],
          ),
        ],
      ),
      ...(model.editChapters.length === 0
        ? [h.p([h.Class("text-sm text-gray-500")], ["No chapters yet."])]
        : model.editChapters.map((chapter) =>
            h.div(
              [h.Class("mb-2 flex items-center gap-2")],
              [
                h.input([
                  h.Class(
                    "w-24 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                  ),
                  h.Type("number"),
                  h.Min("0"),
                  h.Value(String(chapter.startSec)),
                  h.Placeholder("sec"),
                  h.OnInput((value) =>
                    UpdatedChapterStart({ id: chapter.id, startSec: Number(value) || 0 }),
                  ),
                  h.OnBlur(BlurredChapterField()),
                ]),
                h.input([
                  h.Class(
                    "flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                  ),
                  h.Type("text"),
                  h.Value(chapter.title),
                  h.Placeholder("Chapter title"),
                  h.OnInput((value) => UpdatedChapterTitle({ id: chapter.id, title: value })),
                  h.OnBlur(BlurredChapterField()),
                ]),
                h.button(
                  [
                    h.Class(
                      "rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:bg-red-900/50 hover:text-red-300 transition-colors",
                    ),
                    h.OnClick(ClickedRemoveChapter({ id: chapter.id })),
                  ],
                  ["✕"],
                ),
              ],
            ),
          )),
    ],
  );

export const editVideoView = (h: Html, model: Model) => {
  const video = Option.isSome(model.editVideo) ? model.editVideo.value : null;

  return h.div(
    [h.Class("mx-auto max-w-2xl")],
    [
      h.button(
        [
          h.Class(
            "mb-6 flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors",
          ),
          h.OnClick(ClickedBack()),
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
      h.h1([h.Class("mb-8 text-2xl font-bold text-white")], [video ? video.title : "New Video"]),
      ...(Option.isSome(model.errorMessage)
        ? [
            h.div(
              [
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
              h.label([h.Class("block text-sm font-medium text-gray-300 mb-1")], ["Title"]),
              h.input([
                h.Class(
                  "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                ),
                h.Type("text"),
                h.Value(model.editTitle),
                h.Placeholder("Video title"),
                h.OnInput((value) => UpdatedTitle({ title: value })),
                h.OnBlur(BlurredEditField()),
              ]),
            ],
          ),
          h.div(
            [],
            [
              h.label([h.Class("block text-sm font-medium text-gray-300 mb-1")], ["Description"]),
              h.textarea(
                [
                  h.Class(
                    "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                  ),
                  h.Placeholder("Video description"),
                  h.Rows(3),
                  h.OnInput((value) => UpdatedDescription({ description: value })),
                  h.OnBlur(BlurredEditField()),
                ],
                [model.editDescription],
              ),
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
                      h.Alt("Poster"),
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
                      ["Upload MP4"],
                    ),
                    h.input([
                      h.Class(
                        "block text-sm text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-600",
                      ),
                      h.Type("file"),
                      h.Accept(".mp4,video/mp4"),
                      h.OnFileChange((files) => SelectedFile({ file: files[0] })),
                    ]),
                    ...(model.selectedFile
                      ? [
                          h.div(
                            [h.Class("mt-3 text-sm text-gray-300")],
                            [
                              "Selected: ",
                              h.span(
                                [h.Class("font-medium text-white")],
                                [model.selectedFile.name],
                              ),
                            ],
                          ),
                        ]
                      : []),
                    h.button(
                      [
                        h.Class(
                          "mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        ),
                        h.Disabled(model.isUploading || !model.selectedFile),
                        h.OnClick(SubmittedUpload()),
                      ],
                      [model.isUploading ? "Uploading & Transcoding..." : "Upload & Transcode"],
                    ),
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
                              h.span([h.Class("text-amber-400")], ["●"]),
                              "Local changes are not live yet. Republish to update.",
                            ],
                          ),
                        ]
                      : []),
                    h.div(
                      [h.Class("flex gap-3")],
                      [
                        h.button(
                          [
                            h.Class(
                              "rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                            ),
                            h.Disabled(model.isPublishing),
                            h.OnClick(ClickedPublish({ id: video.id })),
                          ],
                          [
                            model.isPublishing
                              ? "Publishing..."
                              : isPublished(video)
                                ? "Republish"
                                : "Publish",
                          ],
                        ),
                        ...(isPublished(video)
                          ? [
                              h.button(
                                [
                                  h.Class(
                                    "rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                                  ),
                                  h.Disabled(model.isUnpublishing),
                                  h.OnClick(ClickedUnpublish({ id: video.id })),
                                ],
                                [model.isUnpublishing ? "Unpublishing..." : "Unpublish"],
                              ),
                            ]
                          : []),
                        h.button(
                          [
                            h.Class(
                              "rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 transition-colors",
                            ),
                            h.OnClick(ClickedCopyLink({ url: shareUrl(video.slug) })),
                          ],
                          [model.copiedLink ? "Copied!" : "Copy link"],
                        ),
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

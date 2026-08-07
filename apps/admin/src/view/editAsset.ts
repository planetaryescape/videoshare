import { Option } from "effect";
import { renderMarkdown } from "@videoshare/shared/Markdown";
import { Button, FileDrop, Input, Textarea } from "@foldkit/ui";
import type { html } from "foldkit/html";
import { CHAPTER_PLAYER_ERROR_ID, CHAPTER_PLAYER_ID } from "../chapterPlayback";
import { duplicateStartSecs } from "../chapters";
import { chapterRow } from "./chapterRow";
import { markdownEditorSection } from "./markdownEditor";
import {
  formatDate,
  formatDuration,
  hasUnpublishedChanges,
  isPublished,
  shareUrl,
  type Model,
  type Asset,
} from "../model";
import {
  BlurredEditField,
  ClearedPoster,
  ClickedAddChapter,
  ClickedBack,
  ClickedCopyLink,
  ClickedPublish,
  ClickedUnpublish,
  GotPosterFileDropMessage,
  GotAssetFileDropMessage,
  type Message,
  SubmittedUpload,
  UpdatedDescription,
  UpdatedTitle,
  ClickedAssignAssetToProject,
  ClickedRetryLoadProjects,
} from "../message";

type Html = ReturnType<typeof html<Message>>;

const localMediaUrl = (key: string) =>
  `/media/${key.startsWith("media/") ? key.slice("media/".length) : key}`;

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

const reviewPlayer = (h: Html, video: Asset) =>
  h.section(
    [h.Class("overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50")],
    [
      h.div(
        [h.Class("border-b border-gray-800 px-4 py-3")],
        [
          h.h2(
            [h.Class("text-sm font-medium text-gray-200")],
            [
              video.kind === "image"
                ? "Review image"
                : video.kind === "markdown"
                  ? "Review markdown"
                  : "Review playback",
            ],
          ),
          h.p(
            [h.Class("mt-1 text-sm text-gray-400")],
            [
              video.kind === "image"
                ? "Review the image before publishing."
                : video.kind === "markdown"
                  ? "Preview of the last saved content."
                  : "Run your final playthrough here and tag chapters as you watch.",
            ],
          ),
        ],
      ),
      h.div(
        [h.Class(video.kind === "audio" ? "p-4" : "bg-black")],
        video.kind === "image"
          ? [
              h.img([
                h.Src(localMediaUrl(video.mediaKey)),
                h.Alt(video.title),
                h.Class("block max-h-[70vh] w-full object-contain"),
              ]),
            ]
          : video.kind === "markdown"
            ? [
                h.div(
                  [
                    h.Class(
                      "markdown-stage prose prose-invert max-w-none bg-gray-950 p-4",
                    ),
                    h.InnerHTML(renderMarkdown(video.body ?? "")),
                  ],
                  [],
                ),
              ]
            : [
                (video.kind === "audio" ? h.audio : h.video)(
                  [
                    h.Id(CHAPTER_PLAYER_ID),
                    h.Title(video.title),
                    h.Src(localMediaUrl(video.mediaKey)),
                    h.DataAttribute("hls-source", localMediaUrl(video.mediaKey)),
                    h.Controls(true),
                    h.Preload("metadata"),
                    h.Playsinline(true),
                    h.Crossorigin("anonymous"),
                    ...(video.kind === "video" && video.posterKey
                      ? [h.Poster(localMediaUrl(video.posterKey))]
                      : []),
                    h.Class(
                      video.kind === "audio"
                        ? "block w-full"
                        : "block aspect-video w-full bg-black",
                    ),
                  ],
                  [],
                ),
                h.p(
                  [
                    h.Id(CHAPTER_PLAYER_ERROR_ID),
                    h.AriaLive("assertive"),
                    h.Class("px-4 py-2 text-sm text-red-300 empty:hidden"),
                  ],
                  [],
                ),
              ],
      ),
    ],
  );

const chaptersSection = (h: Html, model: Model) => {
  const duplicates = duplicateStartSecs(model.editChapters);
  const count = model.editChapters.length;
  const canAddChapters = Option.isSome(model.editAsset) && model.editAsset.value.mediaKey !== "";

  return h.section(
    [h.Class("rounded-xl border border-gray-800 bg-gray-900/50")],
    [
      h.div(
        [
          h.Class(
            "flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3",
          ),
        ],
        [
          h.div(
            [],
            [
              h.h2(
                [h.Class("text-sm font-medium text-gray-200")],
                [
                  "Chapters",
                  ...(count > 0 ? [h.span([h.Class("ml-2 text-gray-500")], [`${count}`])] : []),
                ],
              ),
              h.p(
                [h.Class("mt-1 text-sm text-gray-400")],
                ["Chapters stay sorted by start time and save as you go."],
              ),
            ],
          ),
          ...(canAddChapters
            ? [
                h.button(
                  [
                    h.Type("button"),
                    h.OnClick(ClickedAddChapter()),
                    h.Class(
                      "flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
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
                      [h.path([h.D("M12 5v14M5 12h14")], [])],
                    ),
                    "Add at playhead",
                  ],
                ),
              ]
            : []),
        ],
      ),
      h.div(
        [h.Class("p-4")],
        [
          ...(count === 0
            ? [
                h.p(
                  [
                    h.Class(
                      "rounded-lg border border-dashed border-gray-700 px-4 py-6 text-center text-sm text-gray-500",
                    ),
                  ],
                  ["No chapters yet. Play the media, then add one at the playhead."],
                ),
              ]
            : [
                h.ul(
                  [h.Class("chapter-list space-y-2")],
                  model.editChapters.map((chapter) =>
                    chapterRow(h, chapter, model.chapterStartDrafts[chapter.id], duplicates),
                  ),
                ),
              ]),
          ...(Option.isSome(model.chapterValidationError)
            ? [
                h.p(
                  [h.Role("status"), h.Class("mt-3 text-sm text-red-300")],
                  [model.chapterValidationError.value],
                ),
              ]
            : []),
        ],
      ),
    ],
  );
};

export const editAssetView = (h: Html, model: Model) => {
  const video = Option.isSome(model.editAsset) ? model.editAsset.value : null;
  const selectedImage =
    Option.isSome(model.selectedFile) && model.selectedFile.value.type.startsWith("image/");

  return h.div(
    [h.Class("mx-auto max-w-4xl")],
    [
      Button.view<Message>({
        onClick: ClickedBack(),
        isDisabled: model.isUploading,
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
              " Back to assets",
            ],
          ),
      }),
      h.h1([h.Class("mb-8 text-2xl font-bold text-white")], [video ? video.title : "New Asset"]),
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
                placeholder: "Asset title",
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
                      h.span([...description, h.Class("sr-only")], ["Asset title"]),
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
                placeholder: "Asset description",
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
          ...(video
            ? [
                h.div(
                  [],
                  [
                    h.label(
                      [
                        h.For("asset-project"),
                        h.Class("block text-sm font-medium text-gray-300 mb-1"),
                      ],
                      ["Project"],
                    ),
                    model.projectsLoadState._tag === "ProjectsLoaded"
                      ? h.select(
                          [
                            h.Id("asset-project"),
                            h.Value(video.projectId ?? ""),
                            h.OnChange((projectId) =>
                              ClickedAssignAssetToProject({ assetId: video.id, projectId }),
                            ),
                            h.Disabled(
                              model.projectMembershipOperation._tag === "ProjectMembershipSaving",
                            ),
                            h.Class("w-full rounded-lg bg-gray-800 p-2 text-white"),
                          ],
                          [
                            h.option([h.Value("")], ["Unfiled"]),
                            ...model.projects.map((project) =>
                              h.option([h.Value(project.id)], [project.title]),
                            ),
                          ],
                        )
                      : model.projectsLoadState._tag === "ProjectsFailed"
                        ? h.div(
                            [h.Class("flex items-center gap-3")],
                            [
                              h.p(
                                [h.Role("alert"), h.Class("text-sm text-red-300")],
                                ["Could not load projects."],
                              ),
                              h.button(
                                [
                                  h.Type("button"),
                                  h.OnClick(ClickedRetryLoadProjects()),
                                  h.Class("text-sm font-medium text-blue-300 hover:text-blue-200"),
                                ],
                                ["Retry"],
                              ),
                            ],
                          )
                        : h.p([h.Class("text-sm text-gray-500")], ["Loading projects…"]),
                    ...(video.projectId
                      ? [
                          h.p(
                            [h.Class("mt-1 text-xs text-amber-300")],
                            ["Moving this asset changes its current project membership."],
                          ),
                        ]
                      : []),
                  ],
                ),
              ]
            : []),
          ...(video?.posterKey
            ? [
                h.div(
                  [],
                  [
                    h.p([h.Class("block text-sm font-medium text-gray-300 mb-1")], ["Poster"]),
                    h.img([
                      h.Src(localMediaUrl(video.posterKey)),
                      h.Alt(`Poster for ${video.title}`),
                      h.Class("w-full max-w-sm rounded-lg border border-gray-700"),
                    ]),
                  ],
                ),
              ]
            : []),
          ...(!video || !video.mediaKey
            ? [
                h.div(
                  [h.Class("rounded-lg border border-dashed border-gray-600 bg-gray-900/50 p-6")],
                  [
                    h.p(
                      [h.Class("block text-sm font-medium text-gray-300 mb-3")],
                      ["Upload video, audio, image, or markdown"],
                    ),
                    h.submodel({
                      slotId: model.videoFileDrop.id,
                      model: model.videoFileDrop,
                      view: FileDrop.view,
                      viewInputs: {
                        accept: [
                          ".mp4",
                          "video/mp4",
                          ".mp3",
                          ".m4a",
                          ".aac",
                          ".flac",
                          "audio/*",
                          ".jpg",
                          ".jpeg",
                          ".png",
                          ".webp",
                          "image/jpeg",
                          "image/png",
                          "image/webp",
                          ".md",
                          "text/markdown",
                        ],
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
                      toParentMessage: (message) => GotAssetFileDropMessage({ message }),
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
                    ...(selectedImage
                      ? []
                      : [
                          h.p(
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
                        ]),
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
                          [
                            model.isUploading &&
                            Option.isSome(model.selectedFile) &&
                            model.selectedFile.value.type.startsWith("image/")
                              ? "Uploading..."
                              : model.isUploading
                                ? "Uploading & Transcoding..."
                                : "Upload media",
                          ],
                        ),
                    }),
                    ...(model.isUploading ? [uploadProgress(h, model)] : []),
                  ],
                ),
              ]
            : []),
          ...(video?.mediaKey ? [reviewPlayer(h, video)] : []),
          ...(video?.mediaKey
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
          ...(video?.kind === "markdown" ? [markdownEditorSection(h, model)] : []),
          ...(video && video.kind !== "image" && video.kind !== "markdown"
            ? [chaptersSection(h, model)]
            : []),
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
                    ...(video.kind === "image"
                      ? [
                          h.div(
                            [],
                            [
                              "Dimensions: ",
                              h.span(
                                [h.Class("text-gray-400")],
                                [`${video.width ?? "?"} × ${video.height ?? "?"}`],
                              ),
                            ],
                          ),
                        ]
                      : video.kind === "markdown"
                        ? []
                        : [
                            h.div(
                              [],
                              [
                                "Duration: ",
                                h.span(
                                  [h.Class("text-gray-400")],
                                  [formatDuration(video.durationSec)],
                                ),
                              ],
                            ),
                          ]),
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

import { renderMarkdown } from "@videoshare/shared/Markdown";
import { Button, Textarea } from "@foldkit/ui";
import type { html } from "foldkit/html";
import type { Model } from "../model";
import {
  ClickedSaveMarkdown,
  ToggledMarkdownPreview,
  UpdatedMarkdownBody,
  type Message,
} from "../message";

type Html = ReturnType<typeof html<Message>>;

const saveButtonLabel = (model: Model): string => {
  if (model.markdownSaveStatus._tag === "MarkdownSaving") return "Saving...";
  if (model.markdownSaveStatus._tag === "MarkdownSaved") return "Saved";
  return "Save";
};

export const markdownEditorSection = (h: Html, model: Model) => {
  const isSaving = model.markdownSaveStatus._tag === "MarkdownSaving";

  return h.section(
    [h.Class("overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50")],
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
              h.h2([h.Class("text-sm font-medium text-gray-200")], ["Content"]),
              h.p(
                [h.Class("mt-1 text-sm text-gray-400")],
                ["Write markdown, then preview and save."],
              ),
            ],
          ),
          h.div(
            [h.Class("flex items-center gap-2")],
            [
              Button.view<Message>({
                onClick: ToggledMarkdownPreview(),
                toView: ({ button }) =>
                  h.button(
                    [
                      ...button,
                      h.Class(
                        "rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800",
                      ),
                    ],
                    [model.markdownPreviewOpen ? "Edit" : "Preview"],
                  ),
              }),
              Button.view<Message>({
                onClick: ClickedSaveMarkdown(),
                isDisabled: isSaving,
                toView: ({ button }) =>
                  h.button(
                    [
                      ...button,
                      h.Class(
                        "rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:not-data-[disabled]:bg-blue-500 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                      ),
                    ],
                    [saveButtonLabel(model)],
                  ),
              }),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("p-4")],
        [
          ...(model.markdownSaveStatus._tag === "MarkdownSaveFailed"
            ? [
                h.p(
                  [h.Role("alert"), h.Class("mb-3 text-sm text-red-300")],
                  [model.markdownSaveStatus.error],
                ),
              ]
            : []),
          model.markdownPreviewOpen
            ? h.div(
                [
                  h.Class("markdown-stage prose prose-invert max-w-none"),
                  h.InnerHTML(renderMarkdown(model.markdownBody)),
                ],
                [],
              )
            : Textarea.view<Message>({
                id: "markdown-body",
                value: model.markdownBody,
                rows: 16,
                placeholder: "Write markdown here…",
                onInput: (value) => UpdatedMarkdownBody({ body: value }),
                toView: ({ textarea, label, description }) =>
                  h.div(
                    [],
                    [
                      h.label([...label, h.Class("sr-only")], ["Markdown content"]),
                      h.textarea(
                        [
                          ...textarea,
                          h.Class(
                            "block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                          ),
                        ],
                        [],
                      ),
                      h.span([...description, h.Class("sr-only")], ["Markdown source"]),
                    ],
                  ),
              }),
        ],
      ),
    ],
  );
};

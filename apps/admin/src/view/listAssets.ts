import { Option } from "effect";
import { Button } from "@foldkit/ui";
import type { html } from "foldkit/html";
import {
  formatDate,
  formatDuration,
  hasUnpublishedChanges,
  type Model,
  type Asset,
} from "../model";
import {
  ClickedDeleteAsset,
  ClickedEditAsset,
  type Message,
  SubmittedCreateAsset,
} from "../message";

type Html = ReturnType<typeof html<Message>>;

const renderRow = (h: Html, video: Asset) =>
  h.keyed("tr")(
    video.id,
    [h.Class("transition-colors hover:bg-gray-800/50")],
    [
      h.td(
        [h.Class("px-4 py-3")],
        [
          Button.view<Message>({
            onClick: ClickedEditAsset({ id: video.id }),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.Class("font-medium text-white transition-colors hover:text-blue-300"),
                ],
                [video.title],
              ),
          }),
        ],
      ),
      h.td([h.Class("px-4 py-3 text-gray-400 font-mono text-xs")], [video.slug]),
      h.td(
        [h.Class("px-4 py-3")],
        [
          video.publishedAt
            ? hasUnpublishedChanges(video)
              ? h.span(
                  [
                    h.Class(
                      "rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-300",
                    ),
                  ],
                  ["Changes pending"],
                )
              : h.span(
                  [
                    h.Class(
                      "rounded-full bg-green-900/50 px-2 py-0.5 text-xs font-medium text-green-300",
                    ),
                  ],
                  ["Live"],
                )
            : h.span(
                [
                  h.Class(
                    "rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs font-medium text-yellow-300",
                  ),
                ],
                ["Draft"],
              ),
        ],
      ),
      h.td(
        [h.Class("px-4 py-3 text-gray-400")],
        [video.durationSec > 0 ? formatDuration(video.durationSec) : "-"],
      ),
      h.td([h.Class("px-4 py-3 text-gray-400")], [formatDate(video.createdAt)]),
      h.td(
        [h.Class("px-4 py-3")],
        [
          Button.view<Message>({
            onClick: ClickedDeleteAsset({ id: video.id }),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.Class(
                    "rounded px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors",
                  ),
                ],
                ["Delete"],
              ),
          }),
        ],
      ),
    ],
  );

const renderRows = (h: Html, model: Model) => {
  if (model.assets.length === 0) {
    return [
      h.tr(
        [],
        [h.td([h.Colspan(6), h.Class("px-4 py-8 text-center text-gray-500")], ["No assets yet"])],
      ),
    ];
  }
  return model.assets.map((video) => renderRow(h, video));
};

export const listAssetsView = (h: Html, model: Model) =>
  h.div(
    [h.Class("mx-auto max-w-6xl")],
    [
      h.div(
        [h.Class("flex items-center justify-between mb-8")],
        [
          h.h1([h.Class("text-2xl font-bold text-white")], ["Assets"]),
          Button.view<Message>({
            onClick: SubmittedCreateAsset(),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.Class(
                    "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors",
                  ),
                ],
                ["New Asset"],
              ),
          }),
        ],
      ),
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
        [h.Class("overflow-hidden rounded-lg border border-gray-700 bg-gray-900")],
        [
          h.table(
            [h.Class("w-full text-left text-sm")],
            [
              h.caption([h.Class("sr-only")], ["Assets available to edit and publish"]),
              h.thead(
                [],
                [
                  h.tr(
                    [h.Class("border-b border-gray-700 bg-gray-800/50")],
                    [
                      h.th([h.Class("px-4 py-3 font-medium text-gray-300")], ["Title"]),
                      h.th([h.Class("px-4 py-3 font-medium text-gray-300")], ["Slug"]),
                      h.th([h.Class("px-4 py-3 font-medium text-gray-300")], ["Status"]),
                      h.th([h.Class("px-4 py-3 font-medium text-gray-300")], ["Duration"]),
                      h.th([h.Class("px-4 py-3 font-medium text-gray-300")], ["Created"]),
                      h.th([h.Class("px-4 py-3 font-medium text-gray-300")], [""]),
                    ],
                  ),
                ],
              ),
              h.tbody([h.Class("divide-y divide-gray-800")], [...renderRows(h, model)]),
            ],
          ),
        ],
      ),
    ],
  );

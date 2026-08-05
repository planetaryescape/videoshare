import { Button, Dialog } from "@foldkit/ui";
import { Option } from "effect";
import type { html } from "foldkit/html";
import {
  ClickedConfirmPendingAction,
  GotConfirmationDialogMessage,
  type Message,
} from "../message";
import type { Model } from "../model";

type Html = ReturnType<typeof html<Message>>;

export const confirmationDialogView = (h: Html, model: Model) => {
  const pending = Option.getOrUndefined(model.pendingConfirmation);
  const isProjectDelete = pending?._tag === "DeleteProjectConfirmation";
  const isDelete = pending?._tag === "DeleteAssetConfirmation" || isProjectDelete;
  const assetId =
    pending?._tag === "DeleteAssetConfirmation" || pending?._tag === "UnpublishAssetConfirmation"
      ? pending.assetId
      : undefined;
  const asset =
    assetId === undefined ? undefined : model.assets.find((item) => item.id === assetId);
  const assetLabel = asset?.kind ?? "asset";
  const title = isProjectDelete
    ? "Delete project?"
    : isDelete
      ? `Delete ${assetLabel}?`
      : `Unpublish ${assetLabel}?`;
  const deletedProject =
    pending?._tag === "DeleteProjectConfirmation" &&
    Option.isSome(model.editProject) &&
    model.editProject.value.project.id === pending.projectId
      ? model.editProject.value.project
      : undefined;
  const description = isProjectDelete
    ? deletedProject !== undefined && deletedProject.publishedAt !== null
      ? "This removes the published project. Assets, media, and direct links remain; local assets become unfiled."
      : "This deletes the draft project. Assets, media, and direct links remain; local assets become unfiled."
    : isDelete
      ? `This permanently deletes the local ${assetLabel} and cannot be undone.`
      : `This takes the ${assetLabel} offline and removes its published media. You can publish it again later.`;

  return h.submodel({
    slotId: model.confirmationDialog.id,
    model: model.confirmationDialog,
    view: Dialog.view,
    viewInputs: {
      toView: ({
        dialog,
        backdrop,
        panel,
        title: titleAttributes,
        description: descriptionAttributes,
        closeButton,
        isVisible,
      }) =>
        h.dialog(
          [...dialog, h.Class("fixed inset-0 size-full max-h-none max-w-none bg-transparent p-0")],
          isVisible
            ? [
                h.div([...backdrop, h.Class("fixed inset-0 bg-black/70")], []),
                h.div(
                  [
                    ...panel,
                    h.Class(
                      "fixed left-1/2 top-1/2 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl",
                    ),
                  ],
                  [
                    h.h2(
                      [...titleAttributes, h.Class("text-lg font-semibold text-white")],
                      [title],
                    ),
                    h.p(
                      [...descriptionAttributes, h.Class("mt-2 text-sm text-gray-300")],
                      [description],
                    ),
                    h.div(
                      [h.Class("mt-6 flex justify-end gap-3")],
                      [
                        Button.view<Message>({
                          toView: ({ button }) =>
                            h.button(
                              [
                                ...button,
                                ...closeButton,
                                h.Class(
                                  "rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600",
                                ),
                              ],
                              ["Cancel"],
                            ),
                        }),
                        Button.view<Message>({
                          onClick: ClickedConfirmPendingAction(),
                          toView: ({ button }) =>
                            h.button(
                              [
                                ...button,
                                h.Class(
                                  "rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500",
                                ),
                              ],
                              [isDelete ? "Delete" : "Unpublish"],
                            ),
                        }),
                      ],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: (message) => GotConfirmationDialogMessage({ message }),
  });
};

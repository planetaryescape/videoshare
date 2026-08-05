import { html } from "foldkit/html";
import type { Message } from "../message";
import type { Model } from "../model";
import { confirmationDialogView } from "./confirmationDialog";
import { editAssetView } from "./editAsset";
import { listAssetsView } from "./listAssets";
import { projectEditView, projectListView } from "./projects";

export const view = (model: Model) => {
  const h = html<Message>();
  return {
    title: "Assetshare Admin",
    body: h.main(
      [h.Class("min-h-screen bg-gray-950")],
      [
        h.div(
          [h.Class("px-6 py-8")],
          [
            model.screen._tag === "ListAssets"
              ? listAssetsView(h, model)
              : model.screen._tag === "ProjectList"
                ? projectListView(h, model)
                : model.screen._tag === "ProjectEdit"
                  ? projectEditView(h, model)
                  : editAssetView(h, model),
            confirmationDialogView(h, model),
          ],
        ),
      ],
    ),
  };
};

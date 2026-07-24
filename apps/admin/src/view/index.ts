import { html } from "foldkit/html";
import type { Message } from "../message";
import type { Model } from "../model";
import { editVideoView } from "./editVideo";
import { listVideosView } from "./listVideos";

export const view = (model: Model) => {
  const h = html<Message>();
  return {
    title: "Videoshare Admin",
    body: h.main(
      [h.Class("min-h-screen bg-gray-950")],
      [
        h.div(
          [h.Class("px-6 py-8")],
          [model.screen._tag === "ListVideos" ? listVideosView(h, model) : editVideoView(h, model)],
        ),
      ],
    ),
  };
};

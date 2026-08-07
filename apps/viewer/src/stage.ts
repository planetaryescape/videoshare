import type { Asset } from "@videoshare/shared/Asset";
import { escapeHtml } from "./escapeHtml.ts";

export const renderStage = (
  asset: Asset,
  mediaUrl: string,
  posterUrl: string | null,
  chaptersTrack: string | null,
  markdownHtml?: string | null,
) => {
  if (asset.kind === "image") {
    return `<div class="image-stage"><img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(asset.title)}"></div>`;
  }

  if (asset.kind === "markdown") {
    return `<article class="markdown-stage">${markdownHtml ?? ""}</article>`;
  }

  const isAudio = asset.kind === "audio";
  return `<media-player
          title="${escapeHtml(asset.title)}"
          src="${escapeHtml(mediaUrl)}"
          view-type="${isAudio ? "audio" : "video"}"
          stream-type="on-demand"
          playsinline
          crossorigin
          ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""}
        >
          <media-outlet>
            ${chaptersTrack ? `<track kind="chapters" src="${escapeHtml(chaptersTrack)}" default>` : ""}
          </media-outlet>
          <media-community-skin></media-community-skin>
        </media-player>`;
};

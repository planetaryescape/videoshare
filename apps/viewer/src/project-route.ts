import type { Asset } from "@videoshare/shared/Asset";

export type ProjectRoute =
  | { readonly _tag: "page"; readonly projectSlug: string; readonly assetSlug: string | null }
  | {
      readonly _tag: "media";
      readonly projectSlug: string;
      readonly assetSlug: string;
      readonly file: string;
    }
  | { readonly _tag: "invalid" };

/** `summary` is reserved; `media` is a media prefix only when asset and file follow it. */
export const parseProjectRoute = (segments: ReadonlyArray<string>): ProjectRoute => {
  const [projectSlug, second, ...rest] = segments;
  if (!projectSlug || projectSlug.includes("..")) return { _tag: "invalid" };
  if (second === "media" && rest.length >= 2) {
    const [assetSlug, ...fileSegments] = rest;
    const file = fileSegments.join("/");
    return !assetSlug || !file || file.includes("..")
      ? { _tag: "invalid" }
      : { _tag: "media", projectSlug, assetSlug, file };
  }
  if (rest.length > 0) return { _tag: "invalid" };
  return { _tag: "page", projectSlug, assetSlug: second ?? null };
};

/** Returns the project password cookie name for a project slug. */
export const projectCookieName = (projectSlug: string) => `project_auth_${projectSlug}`;

export const isProjectAuthorized = (
  cookies: ReadonlyMap<string, string>,
  projectSlug: string,
  passwordHash: string | null,
) => passwordHash === null || cookies.get(projectCookieName(projectSlug)) === passwordHash;

const isAbsoluteHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/** Public project media has stable, replaceable keys, so every response must revalidate. */
export const projectCacheControl = (passwordHash: string | null, _isManifest: boolean) =>
  passwordHash !== null ? "private, no-store" : "no-cache";

/**
 * Public projects may render an external media URL directly. Protected projects retain the media
 * route so an unexpected legacy external key is never exposed outside the project cookie boundary.
 */
export const projectMediaUrl = (
  projectSlug: string,
  assetSlug: string,
  mediaKey: string,
  passwordHash: string | null,
) => {
  if (passwordHash === null && isAbsoluteHttpUrl(mediaKey)) return mediaKey;
  const file = mediaKey.slice(mediaKey.lastIndexOf("/") + 1);
  return `/p/${encodeURIComponent(projectSlug)}/media/${encodeURIComponent(assetSlug)}/${encodeURIComponent(file)}`;
};

export const renderProjectGate = (input: {
  readonly title: string;
  readonly action: string;
  readonly error?: string;
  readonly escapeHtml: (value: string) => string;
  readonly faviconLinks: string;
}) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${input.escapeHtml(input.title)}</title>${input.faviconLinks}</head><body><main><h1>${input.escapeHtml(input.title)}</h1><p>This project is password protected.</p>${input.error ? `<div role="alert">${input.escapeHtml(input.error)}</div>` : ""}<form method="post" action="${input.escapeHtml(input.action)}"><label for="password">Password</label><input id="password" name="password" type="password" required autofocus><button type="submit">Open project</button></form></main></body></html>`;

/** Server-rendered selected page, with inert escaped stage fragments for in-place enhancement. */
export const renderProjectPage = (input: {
  readonly projectSlug: string;
  readonly project: { readonly title: string; readonly description: string | null };
  readonly assets: ReadonlyArray<Asset>;
  readonly selected: Asset | null;
  readonly stages: ReadonlyArray<string>;
  readonly escapeHtml: (value: string) => string;
  readonly faviconLinks: string;
  readonly playerCssHref: string;
  readonly projectCssHref: string;
  readonly projectScriptHref: string;
}) => {
  const { projectSlug, project, assets, selected, stages, escapeHtml } = input;
  const memberPath = (slug: string) =>
    `/p/${encodeURIComponent(projectSlug)}/${encodeURIComponent(slug)}`;
  const summaryPath = `/p/${encodeURIComponent(projectSlug)}/summary`;
  const control = (
    action: "previous" | "next" | "restart",
    label: string,
    href: string,
    disabled = false,
  ) =>
    `<a class="project-control${disabled ? " is-disabled" : ""}" data-project-action="${action}" href="${href}" aria-disabled="${disabled}"${disabled ? ' tabindex="-1"' : ""}>${label}</a>`;
  const selectedSlug = selected?.slug ?? "summary";
  const selectedIndex = selected ? assets.findIndex((asset) => asset.slug === selected.slug) : -1;
  const metadata = (asset: Asset | null, index: number) =>
    asset
      ? `<div data-member-meta data-title="${escapeHtml(asset.title)}" data-description="${escapeHtml(asset.description ?? "")}" data-position="${index + 1} of ${assets.length} · ${asset.kind}"></div>`
      : `<div data-member-meta data-title="Project complete" data-description="You have reached the end of this project." data-position="${assets.length} members"></div>`;
  const fragment = (asset: Asset, index: number) =>
    `<template id="project-member-${index}" data-member-kind="${escapeHtml(asset.kind)}"><div>${stages[index] ?? ""}</div>${metadata(asset, index)}</template>`;
  const summaryContent = `<section class="project-summary">${metadata(null, -1)}<h2>Project complete</h2><p>You have reached the end of this project.</p><ul>${assets.map((asset, index) => `<li><a href="${memberPath(asset.slug)}" data-project-member="${escapeHtml(asset.slug)}" data-project-index="${index}">${index + 1}. ${escapeHtml(asset.title)}</a></li>`).join("")}</ul>${control("restart", "Restart project", memberPath(assets[0]?.slug ?? "summary"), assets.length === 0)}</section>`;
  const summary = `<template id="project-summary">${summaryContent}</template>`;
  const initialStage = selected
    ? `${stages[selectedIndex] ?? ""}${metadata(selected, selectedIndex)}`
    : summaryContent;
  const links = assets
    .map(
      (asset, index) =>
        `<li><a href="${memberPath(asset.slug)}" data-project-member="${escapeHtml(asset.slug)}" data-project-index="${index}"${asset.slug === selectedSlug ? ' aria-current="page" class="is-active"' : ""}><span class="rail-number">${index + 1}</span><span>${escapeHtml(asset.title)}</span></a></li>`,
    )
    .join("");
  const isSummary = selected === null;
  const previous = isSummary
    ? assets.length > 0
      ? memberPath(assets[assets.length - 1]?.slug ?? "")
      : summaryPath
    : selectedIndex > 0
      ? memberPath(assets[selectedIndex - 1]?.slug ?? "")
      : memberPath(assets[0]?.slug ?? "summary");
  const previousDisabled = !isSummary && selectedIndex === 0;
  const next = isSummary
    ? memberPath(assets[0]?.slug ?? "summary")
    : selectedIndex + 1 < assets.length
      ? memberPath(assets[selectedIndex + 1]?.slug ?? "")
      : summaryPath;
  const nextLabel = isSummary ? "Restart" : "Next";
  const nextAction = isSummary ? "restart" : "next";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(project.title)}</title>${input.faviconLinks}<link rel="stylesheet" href="${input.playerCssHref}"><link rel="stylesheet" href="${input.projectCssHref}"><script type="module" src="${input.projectScriptHref}"></script></head><body><main class="project" data-project-player data-project-slug="${escapeHtml(projectSlug)}" data-member-slugs="${assets.map((asset) => escapeHtml(asset.slug)).join(",")}" data-member-kinds="${assets.map((asset) => escapeHtml(asset.kind)).join(",")}" data-selected="${escapeHtml(selectedSlug)}"><header class="project-header"><h1>${escapeHtml(project.title)}</h1><p>${escapeHtml(project.description ?? "")}</p></header><p class="project-status" aria-live="polite" data-project-status></p><div class="project-layout"><section><div class="project-stage" data-project-stage>${initialStage}</div><div class="project-meta"><span class="project-position" data-project-position>${selected ? `${selectedIndex + 1} of ${assets.length} · ${escapeHtml(selected.kind)}` : `${assets.length} members`}</span><h2 data-project-title>${escapeHtml(selected?.title ?? "Project complete")}</h2><p data-project-description>${escapeHtml(selected?.description ?? "You have reached the end of this project.")}</p></div><nav class="project-controls" data-project-controls aria-label="Project playback">${control("previous", "Previous", previous, previousDisabled)}${control(nextAction, nextLabel, next)}</nav></section><nav class="project-rail" aria-label="Project members"><h2>In this project</h2><ol>${links}</ol></nav></div>${assets.map(fragment).join("")}${summary}</main></body></html>`;
};

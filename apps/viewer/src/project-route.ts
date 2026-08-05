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

/** Parses safe project paths. Page routes have exactly project or project/member arity. */
export const parseProjectRoute = (segments: ReadonlyArray<string>): ProjectRoute => {
  const [projectSlug, second, ...rest] = segments;
  if (!projectSlug || projectSlug.includes("..")) return { _tag: "invalid" };
  // A member can legitimately be named `media`; reserve it only for a route with a media suffix.
  if (second !== "media" || rest.length === 0) {
    if (rest.length > 0) return { _tag: "invalid" };
    return { _tag: "page", projectSlug, assetSlug: second ?? null };
  }
  const [assetSlug, ...fileSegments] = rest;
  const file = fileSegments.join("/");
  if (!assetSlug || !file || file.includes("..")) return { _tag: "invalid" };
  return { _tag: "media", projectSlug, assetSlug, file };
};

/**
 * Project routes intentionally authorize only against the project grant. That grant supersedes a
 * member asset password here; direct asset URLs continue to use their independent asset cookie.
 */
export const isProjectAuthorized = (
  cookies: ReadonlyMap<string, string>,
  projectSlug: string,
  passwordHash: string | null,
) => passwordHash === null || cookies.get(`project_auth_${projectSlug}`) === passwordHash;

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

/** Renders a generic project gate; it deliberately includes no selected-member metadata or artwork. */
export const renderProjectGate = (input: {
  readonly title: string;
  readonly action: string;
  readonly error?: string;
  readonly escapeHtml: (value: string) => string;
  readonly faviconLinks: string;
}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${input.escapeHtml(input.title)}</title>${input.faviconLinks}</head>
<body><main><h1>${input.escapeHtml(input.title)}</h1><p>This project is password protected.</p>${input.error ? `<div role="alert">${input.escapeHtml(input.error)}</div>` : ""}<form method="post" action="${input.escapeHtml(input.action)}"><label for="password">Password</label><input id="password" name="password" type="password" required autofocus><button type="submit">Open project</button></form></main></body></html>`;

/** Renders the simple ordered project page and stable member links. */
export const renderProjectPage = (input: {
  readonly projectSlug: string;
  readonly project: { readonly title: string; readonly description: string | null };
  readonly assets: ReadonlyArray<Asset>;
  readonly selected: Asset;
  readonly stage: string;
  readonly escapeHtml: (value: string) => string;
  readonly faviconLinks: string;
  readonly playerCssHref: string;
  readonly playerScriptHref: string;
}) => {
  const { projectSlug, project, assets, selected, stage, escapeHtml } = input;
  const memberPath = (slug: string) =>
    `/p/${encodeURIComponent(projectSlug)}/${encodeURIComponent(slug)}`;
  const links = assets
    .map(
      (asset, index) =>
        `<li${asset.slug === selected.slug ? ' aria-current="page"' : ""}><a href="${memberPath(asset.slug)}">${index + 1}. ${escapeHtml(asset.title)}</a></li>`,
    )
    .join("");
  const index = assets.findIndex((asset) => asset.slug === selected.slug);
  const previous = assets[index - 1];
  const next = assets[index + 1];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(project.title)}</title>${input.faviconLinks}<link rel="stylesheet" href="${input.playerCssHref}">${selected.kind === "image" ? "" : `<script type="module" src="${input.playerScriptHref}"></script>`}<style>body{margin:0;background:#09090f;color:#f5f7fb;font-family:system-ui}main{max-width:1080px;margin:auto;padding:24px}.stage{background:#000;border-radius:16px;overflow:hidden}nav a{color:#c9beff}li[aria-current=page] a{color:#fff;font-weight:bold}.pager{display:flex;justify-content:space-between;margin:20px 0}</style></head><body><main><h1>${escapeHtml(project.title)}</h1><p>${escapeHtml(project.description ?? "")}</p><div class="stage">${stage}</div><div class="pager">${previous ? `<a href="${memberPath(previous.slug)}">Previous</a>` : "<span></span>"}${next ? `<a href="${memberPath(next.slug)}">Next</a>` : "<span></span>"}</div><ol>${links}</ol></main></body></html>`;
};

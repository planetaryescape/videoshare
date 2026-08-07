import { D1Client } from "@effect/sql-d1";
import { ViewerCatalog } from "@videoshare/shared/ViewerCatalog";
import { r2KeyDir } from "@videoshare/shared/MediaKey";
import { sha256Hex } from "@videoshare/shared/Sha256";
import { verifyProjectPassword } from "@videoshare/shared/ProjectPassword";
import { renderMarkdown } from "@videoshare/shared/Markdown";
import type { Chapter, Asset } from "@videoshare/shared/Asset";
import { Effect, Layer, Option } from "effect";
import playerCss from "../generated/player.css?raw";
import playerScript from "../generated/player.js?raw";
import projectCss from "../generated/project.css?raw";
import projectScript from "../generated/project.js?raw";
import { appleTouchIconBase64, favicon16Base64, favicon32Base64 } from "../generated/favicons";
import { escapeHtml } from "./escapeHtml.ts";
import { renderStage } from "./stage.ts";
import {
  isProjectAuthorized,
  parseProjectRoute,
  projectCookieName,
  projectCacheControl,
  projectMediaUrl,
  renderProjectGate,
  renderProjectPage,
} from "./project-route.ts";

interface R2ObjectBody {
  readonly body: ReadableStream | null;
  readonly httpEtag: string;
  readonly size: number;
  readonly httpMetadata?: { readonly contentType?: string };
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

type ViewerEnv = {
  readonly DB: Parameters<typeof D1Client.layer>[0]["db"];
  readonly BUCKET: R2Bucket;
};

const cookieMaxAgeSeconds = 60 * 60 * 24;
const assetCacheControl = "public, max-age=31536000, immutable";

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const assetVersion = hashString(playerCss + playerScript);
const projectVersion = hashString(projectCss + projectScript);

const faviconLinks = `<link rel="icon" type="image/png" sizes="32x32" href="/_assets/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/_assets/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/_assets/apple-touch-icon.png">`;

const markdownStageCss = `.markdown-stage { max-width: 68ch; margin: 0 auto; padding: 8px 4px; color: #d7deea; line-height: 1.65; overflow-wrap: break-word; }
      .markdown-stage h1, .markdown-stage h2, .markdown-stage h3, .markdown-stage h4, .markdown-stage h5, .markdown-stage h6 { color: #f5f7fb; line-height: 1.3; margin: 1.4em 0 0.5em; }
      .markdown-stage h1:first-child, .markdown-stage h2:first-child, .markdown-stage h3:first-child { margin-top: 0; }
      .markdown-stage p { color: #d7deea; margin: 0 0 1em; }
      .markdown-stage a { color: #9b87ff; }
      .markdown-stage a:hover { color: #c9beff; }
      .markdown-stage ul, .markdown-stage ol { margin: 0 0 1em; padding-left: 1.4em; }
      .markdown-stage li { margin: 0.3em 0; }
      .markdown-stage blockquote { margin: 0 0 1em; padding: 4px 16px; border-left: 3px solid #7c5cff; color: #b8c0d0; }
      .markdown-stage code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(255,255,255,0.08); padding: 0.15em 0.4em; border-radius: 6px; font-size: 0.9em; }
      .markdown-stage pre { background: #14121f; border: 1px solid #2b2744; border-radius: 12px; padding: 14px 16px; overflow-x: auto; margin: 0 0 1em; }
      .markdown-stage pre code { background: none; padding: 0; border-radius: 0; }
      .markdown-stage table { border-collapse: collapse; margin: 0 0 1em; display: block; overflow-x: auto; max-width: 100%; }
      .markdown-stage th, .markdown-stage td { border: 1px solid #302d43; padding: 8px 12px; text-align: left; }
      .markdown-stage th { color: #f5f7fb; background: rgba(255,255,255,0.04); }
      .markdown-stage img { max-width: 100%; height: auto; border-radius: 10px; }
      .markdown-stage hr { border: 0; border-top: 1px solid #302d43; margin: 1.5em 0; }`;

const catalogLayer = (env: ViewerEnv) =>
  ViewerCatalog.layerNoDeps.pipe(Layer.provide(D1Client.layer({ db: env.DB })));

const runCatalog = <A>(env: ViewerEnv, effect: Effect.Effect<A, unknown, ViewerCatalog>) =>
  Effect.runPromise(effect.pipe(Effect.provide(catalogLayer(env))));

const loadAssetPage = (env: ViewerEnv, slug: string) =>
  runCatalog(
    env,
    Effect.gen(function* () {
      const catalog = yield* ViewerCatalog;
      return yield* catalog.findAssetPage(slug);
    }),
  );

const loadAssetMedia = (env: ViewerEnv, slug: string) =>
  runCatalog(
    env,
    Effect.gen(function* () {
      const catalog = yield* ViewerCatalog;
      return yield* catalog.findAssetMedia(slug);
    }),
  );
const loadProjectPage = (env: ViewerEnv, projectSlug: string, assetSlug: string | null) =>
  runCatalog(
    env,
    Effect.gen(function* () {
      const catalog = yield* ViewerCatalog;
      return yield* catalog.findProjectPage(projectSlug, assetSlug);
    }),
  );
const loadProjectMedia = (env: ViewerEnv, projectSlug: string, assetSlug: string) =>
  runCatalog(
    env,
    Effect.gen(function* () {
      const catalog = yield* ViewerCatalog;
      return yield* catalog.findProjectMedia(projectSlug, assetSlug);
    }),
  );

const sha256 = async (value: string) =>
  sha256Hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const parseCookies = (header: string | null) => {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    cookies.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }

  return cookies;
};

const cookieName = (slug: string) => `video_auth_${slug}`;

const isAuthorized = (request: Request, slug: string, passwordHash: string) =>
  parseCookies(request.headers.get("cookie")).get(cookieName(slug)) === passwordHash;

const isAbsoluteUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const mediaPrefix = (slug: string) => `/${encodeURIComponent(slug)}/`;

const r2ContentType = (key: string) => {
  if (key.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }
  if (key.endsWith(".ts")) {
    return "video/mp2t";
  }
  if (key.endsWith(".m4s") || key.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (key.endsWith(".vtt")) {
    return "text/vtt";
  }
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (key.endsWith(".png")) {
    return "image/png";
  }
  if (key.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
};

const resolveMediaUrl = (slug: string, key: string | null) => {
  if (!key) {
    return null;
  }
  if (isAbsoluteUrl(key)) {
    return key;
  }
  const basename = key.slice(r2KeyDir(key).length);
  return `${mediaPrefix(slug)}${basename}`;
};

const chaptersTrackFor = (chapters: ReadonlyArray<Chapter>) => {
  if (chapters.length === 0) {
    return null;
  }

  const toTimestamp = (seconds: number) => {
    const totalMilliseconds = Math.max(0, Math.floor(seconds * 1000));
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  };

  const cues = chapters.map((chapter, index) => {
    const nextChapter = chapters[index + 1];
    const end = nextChapter ? nextChapter.startSec : chapter.startSec + 60;
    return `${toTimestamp(chapter.startSec)} --> ${toTimestamp(end)}\n${chapter.title}`;
  });

  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${cues.join("\n\n")}`)}`;
};

const passwordPage = (slug: string, title: string, errorMessage?: string) =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    ${faviconLinks}
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0f; color: #f5f7fb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      main { width: min(420px, calc(100vw - 32px)); padding: 32px; border-radius: 24px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); }
      h1 { margin: 0 0 8px; font-size: 1.5rem; }
      p { margin: 0 0 20px; color: #b8c0d0; }
      label { display: block; margin-bottom: 8px; font-size: 0.95rem; }
      input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: inherit; }
      button { margin-top: 16px; width: 100%; padding: 12px 14px; border: 0; border-radius: 14px; background: #7c5cff; color: white; font-weight: 600; cursor: pointer; }
      .error { margin-bottom: 16px; color: #ff8f8f; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>This video is password protected.</p>
      ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
      <form method="post" action="/${encodeURIComponent(slug)}">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autofocus>
        <button type="submit">Watch video</button>
      </form>
    </main>
  </body>
</html>`;

const assetResponse = (body: string, contentType: string) =>
  new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": assetCacheControl,
    },
  });

const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const binaryAssetResponse = (base64: string, contentType: string) =>
  new Response(base64ToBytes(base64), {
    headers: {
      "content-type": contentType,
      "cache-control": assetCacheControl,
    },
  });

const absoluteUrl = (origin: string, value: string | null) => {
  if (!value) {
    return null;
  }
  if (isAbsoluteUrl(value)) {
    return value;
  }
  return `${origin}${value.startsWith("/") ? value : `/${value}`}`;
};

/** Renders safe Open Graph and Twitter metadata for a published asset page. */
export const renderOpenGraphTags = (origin: string, slug: string, asset: Asset) => {
  const pageUrl = `${origin}${mediaPrefix(slug).replace(/\/$/, "")}`;
  const imageUrl = absoluteUrl(
    origin,
    resolveMediaUrl(slug, asset.posterKey ?? (asset.kind === "image" ? asset.mediaKey : null)),
  );
  const description = asset.description ?? "";
  const tags = [
    `<meta property="og:type" content="${asset.kind === "audio" ? "music.song" : asset.kind === "image" ? "website" : "video.other"}">`,
    `<meta property="og:title" content="${escapeHtml(asset.title)}">`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
    `<meta property="og:site_name" content="VideoShare">`,
    `<meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(asset.title)}">`,
  ];
  if (description) {
    tags.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
    tags.push(`<meta name="twitter:description" content="${escapeHtml(description)}">`);
    tags.push(`<meta name="description" content="${escapeHtml(description)}">`);
  }
  if (imageUrl) {
    tags.push(`<meta property="og:image" content="${escapeHtml(imageUrl)}">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`);
  }
  return tags.join("\n    ");
};

const viewerPage = (
  origin: string,
  slug: string,
  asset: Asset,
  chapters: ReadonlyArray<Chapter>,
  markdownHtml: string | null,
) => {
  const isAudio = asset.kind === "audio";
  const isImage = asset.kind === "image";
  const chaptersTrack = isImage ? null : chaptersTrackFor(chapters);
  const posterUrl = resolveMediaUrl(slug, asset.posterKey);
  const manifestUrl = resolveMediaUrl(slug, asset.mediaKey);
  const chapterItems = (isImage ? [] : chapters)
    .map(
      (chapter) => `<li>
        <button type="button" data-chapter-start="${chapter.startSec}" aria-label="Seek to ${escapeHtml(chapter.title)} at ${chapter.startSec} seconds">
          <span>${escapeHtml(chapter.title)}</span>
          <span class="chapter-time">${chapter.startSec}s</span>
        </button>
      </li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(asset.title)}</title>
    ${faviconLinks}
    ${renderOpenGraphTags(origin, slug, asset)}
    <link rel="stylesheet" href="/_assets/player.css?v=${assetVersion}">
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: radial-gradient(circle at top, #1a1630, #09090f 52%); color: #f5f7fb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      main { width: min(1080px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0 64px; }
      h1 { margin: 24px 0 8px; font-size: clamp(2rem, 4vw, 3rem); }
      p { margin: 0; color: #b8c0d0; line-height: 1.6; }
      .player-shell { overflow: hidden; border-radius: 24px; background: #000; box-shadow: 0 24px 80px rgba(0,0,0,0.45); }
      media-player, .image-stage { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
      .image-stage { display: grid; place-items: center; }
      .image-stage img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
      media-player[view-type="audio"],
      media-player[data-view-type="audio"] { aspect-ratio: auto; background: transparent; }
      .player-shell.is-audio { background: transparent; box-shadow: none; border-radius: 0; }
      media-video-layout { --media-brand: #7c5cff; --media-focus-ring-color: #9b87ff; }
      .player-shell:has(.markdown-stage) { background: transparent; box-shadow: none; border-radius: 0; }
      ${markdownStageCss}
      .meta { display: grid; gap: 24px; margin-top: 24px; }
      .chapters { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
      .chapters button { display: flex; width: 100%; justify-content: space-between; gap: 16px; padding: 12px 14px; border: 0; border-radius: 14px; background: rgba(255,255,255,0.05); color: #d7deea; font: inherit; text-align: left; cursor: pointer; transition: background-color 150ms ease, transform 150ms ease; }
      .chapters button:hover { background: rgba(255,255,255,0.1); transform: translateY(-1px); }
      .chapters button:focus-visible { outline: 2px solid #9b87ff; outline-offset: 2px; }
      .chapters button[data-active] { background: rgba(124,92,255,0.22); color: #fff; box-shadow: inset 3px 0 #9b87ff; }
      .chapters button[data-active] .chapter-time { color: #c9beff; }
      .chapter-time { color: #b8c0d0; }
      .slug { margin-top: 20px; font-size: 0.85rem; color: #8e98ab; }
    </style>
    ${isImage ? "" : `<script type="module" src="/_assets/player.js?v=${assetVersion}"></script>`}
  </head>
  <body>
    <main>
      <div class="player-shell${isAudio ? " is-audio" : ""}">
        ${renderStage(asset, manifestUrl ?? asset.mediaKey, posterUrl, chaptersTrack, markdownHtml)}
      </div>
      <div class="meta">
        <div>
          <h1>${escapeHtml(asset.title)}</h1>
          <p>${escapeHtml(asset.description ?? "")}</p>
          <div class="slug">/${escapeHtml(slug)}</div>
        </div>
        ${chapterItems ? `<ul class="chapters">${chapterItems}</ul>` : ""}
      </div>
    </main>
  </body>
</html>`;
};

const notFoundPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Video not found</title>
    ${faviconLinks}
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top, #1a1630, #09090f 52%); color: #f5f7fb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      main { width: min(480px, calc(100vw - 32px)); padding: 40px 32px; border-radius: 24px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
      h1 { margin: 0 0 12px; font-size: 1.75rem; }
      p { margin: 0; color: #b8c0d0; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>Video not found</h1>
      <p>This video is no longer available. The link may have changed or the video may have been unpublished.</p>
    </main>
  </body>
</html>`;

const notFoundResponse = () =>
  new Response(notFoundPage, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const homePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>VideoShare Viewer</title>
    ${faviconLinks}
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090f; color: #f5f7fb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      main { width: min(720px, calc(100vw - 32px)); text-align: center; }
      h1 { margin: 0 0 12px; font-size: clamp(2rem, 5vw, 4rem); }
      p { margin: 0; color: #b8c0d0; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>VideoShare viewer</h1>
      <p>Open a share URL in the form <code>/&lt;slug&gt;</code>.</p>
    </main>
  </body>
</html>`;

const serveR2Media = async (
  env: ViewerEnv,
  request: Request,
  key: string,
  cacheControl: string,
): Promise<Response> => {
  const object = await env.BUCKET.get(key);
  if (!object) return notFoundResponse();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-type", object.httpMetadata?.contentType ?? r2ContentType(key));
  headers.set("cache-control", cacheControl);
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
};

/**
 * Fetches and renders a markdown asset's content.md from R2. Never fetched for non-markdown
 * assets, and a missing or unreadable object degrades to an empty article instead of failing
 * the whole page.
 */
const fetchMarkdownHtml = async (env: ViewerEnv, mediaKey: string): Promise<string | null> => {
  if (isAbsoluteUrl(mediaKey)) return null;
  const key = `${r2KeyDir(mediaKey)}content.md`;
  const object = await env.BUCKET.get(key);
  if (!object || !object.body) return null;
  const source = await new Response(object.body).text();
  return renderMarkdown(source);
};

const serveMedia = async (env: ViewerEnv, request: Request, slug: string, file: string) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (file.includes("..")) {
    return notFoundResponse();
  }

  const result = await loadAssetMedia(env, slug);
  if (Option.isNone(result)) {
    return notFoundResponse();
  }

  const asset = result.value;
  if (asset.passwordHash && !isAuthorized(request, slug, asset.passwordHash)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (isAbsoluteUrl(asset.mediaKey)) {
    return notFoundResponse();
  }

  const key = `${r2KeyDir(asset.mediaKey)}${file}`;
  return serveR2Media(
    env,
    request,
    key,
    asset.passwordHash
      ? "private, no-store"
      : key.endsWith(".m3u8")
        ? "no-cache"
        : assetCacheControl,
  );
};

const serveProject = async (
  env: ViewerEnv,
  request: Request,
  url: URL,
  segments: ReadonlyArray<string>,
): Promise<Response> => {
  const route = parseProjectRoute(segments);
  if (route._tag === "invalid") return notFoundResponse();
  if (route._tag === "media") {
    const { projectSlug, assetSlug, file } = route;
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method Not Allowed", { status: 405 });
    const result = await loadProjectMedia(env, projectSlug, assetSlug);
    if (Option.isNone(result)) return notFoundResponse();
    const { project, asset } = result.value;
    if (
      !isProjectAuthorized(
        parseCookies(request.headers.get("cookie")),
        projectSlug,
        project.passwordHash,
      )
    )
      return notFoundResponse();
    if (isAbsoluteUrl(asset.mediaKey)) return notFoundResponse();
    const key = `${r2KeyDir(asset.mediaKey)}${file}`;
    return serveR2Media(
      env,
      request,
      key,
      projectCacheControl(project.passwordHash, key.endsWith(".m3u8")),
    );
  }
  const { projectSlug, assetSlug } = route;
  // Summary is a project state, not a member lookup. Unknown member slugs still get the catalog's
  // non-disclosing 404 response.
  const page = await loadProjectPage(env, projectSlug, assetSlug === "summary" ? null : assetSlug);
  if (Option.isNone(page)) return notFoundResponse();
  if (request.method !== "GET" && request.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });
  const project = page.value.project;
  if (project.passwordHash) {
    if (request.method === "POST") {
      const password = (await request.formData()).get("password");
      if (
        typeof password !== "string" ||
        !(await verifyProjectPassword(password, project.passwordHash))
      )
        return new Response(
          renderProjectGate({
            title: project.title,
            action: url.pathname,
            error: "Incorrect password.",
            escapeHtml,
            faviconLinks,
          }),
          {
            status: 403,
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          },
        );
      return new Response(null, {
        status: 303,
        headers: {
          location: url.toString(),
          "set-cookie": `${projectCookieName(projectSlug)}=${project.passwordHash}; Max-Age=${cookieMaxAgeSeconds}; Path=/p/${encodeURIComponent(projectSlug)}; HttpOnly; SameSite=Lax; Secure`,
        },
      });
    }
    if (
      !isProjectAuthorized(
        parseCookies(request.headers.get("cookie")),
        projectSlug,
        project.passwordHash,
      )
    )
      return new Response(
        renderProjectGate({ title: project.title, action: url.pathname, escapeHtml, faviconLinks }),
        {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        },
      );
  }
  const selected = assetSlug === "summary" ? null : page.value.selected;
  const markdownHtmlByAssetId = new Map(
    await Promise.all(
      page.value.assets
        .filter((asset) => asset.kind === "markdown")
        .map(
          async (asset) => [asset.id, await fetchMarkdownHtml(env, asset.mediaKey)] as const,
        ),
    ),
  );
  const stages = page.value.assets.map((asset) =>
    renderStage(
      asset,
      projectMediaUrl(projectSlug, asset.slug, asset.mediaKey, project.passwordHash),
      null,
      null,
      markdownHtmlByAssetId.get(asset.id) ?? null,
    ),
  );
  return new Response(
    renderProjectPage({
      projectSlug,
      project: page.value.project,
      assets: page.value.assets,
      selected,
      stages,
      escapeHtml,
      faviconLinks,
      playerCssHref: `/_assets/player.css?v=${assetVersion}`,
      projectCssHref: `/_assets/project.css?v=${projectVersion}`,
      projectScriptHref: `/_assets/project.js?v=${projectVersion}`,
    }),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": project.passwordHash ? "private, no-store" : "no-store",
      },
    },
  );
};

/**
 * A legacy direct asset named `p` collides with the project namespace. A resolved project route
 * wins; a missing root project falls back to that direct asset's media URL.
 */
const serveLegacyPAssetMediaWhenProjectMissing = async (
  projectResponse: Promise<Response>,
  legacyResponse: () => Promise<Response>,
) => {
  const response = await projectResponse;
  return response.status === 404 ? legacyResponse() : response;
};

const serveAssetPage = async (env: ViewerEnv, request: Request, url: URL, slug: string) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const result = await loadAssetPage(env, slug);
    if (Option.isNone(result)) {
      return notFoundResponse();
    }

    const { asset, chapters } = result.value;
    if (asset.passwordHash) {
      if (request.method === "POST") {
        const formData = await request.formData();
        const password = formData.get("password");
        if (typeof password !== "string" || (await sha256(password)) !== asset.passwordHash) {
          return new Response(passwordPage(slug, asset.title, "Incorrect password."), {
            status: 403,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }

        return new Response(null, {
          status: 303,
          headers: {
            location: url.toString(),
            "set-cookie": `${cookieName(slug)}=${asset.passwordHash}; Max-Age=${cookieMaxAgeSeconds}; Path=/${slug}; HttpOnly; SameSite=Lax; Secure`,
          },
        });
      }

      if (!isAuthorized(request, slug, asset.passwordHash)) {
        return new Response(passwordPage(slug, asset.title), {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }

    const markdownHtml =
      asset.kind === "markdown" ? await fetchMarkdownHtml(env, asset.mediaKey) : null;

    return new Response(viewerPage(url.origin, slug, asset, chapters, markdownHtml), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
};

export default {
  async fetch(request: Request, env: ViewerEnv) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (pathname === "/_assets/player.js") {
      return assetResponse(playerScript, "text/javascript; charset=utf-8");
    }

    if (pathname === "/_assets/player.css") {
      return assetResponse(playerCss, "text/css; charset=utf-8");
    }

    if (pathname === "/_assets/project.js") {
      return assetResponse(projectScript, "text/javascript; charset=utf-8");
    }

    if (pathname === "/_assets/project.css") {
      return assetResponse(projectCss, "text/css; charset=utf-8");
    }

    if (pathname === "/_assets/favicon-32x32.png") {
      return binaryAssetResponse(favicon32Base64, "image/png");
    }

    if (pathname === "/_assets/favicon-16x16.png") {
      return binaryAssetResponse(favicon16Base64, "image/png");
    }

    if (pathname === "/_assets/apple-touch-icon.png") {
      return binaryAssetResponse(appleTouchIconBase64, "image/png");
    }

    if (pathname === "/") {
      return new Response(homePage, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (pathname === "/health") {
      return new Response("ok");
    }

    const segments = pathname.slice(1).split("/");
    // Project dispatch precedes generic asset dispatch: project grants never reach direct URLs.
    if (segments[0] === "p") {
      if (segments.length === 1) return serveAssetPage(env, request, url, "p");
      try {
        const projectSegments = segments.slice(1);
        // A one-segment project path is indistinguishable from a legacy direct-media filename.
        // A real project response wins; only its ordinary 404 falls back to direct media.
        if (projectSegments.length === 1)
          return serveLegacyPAssetMediaWhenProjectMissing(
            serveProject(env, request, url, projectSegments),
            () => serveMedia(env, request, "p", projectSegments[0]),
          );
        return await serveProject(env, request, url, projectSegments);
      } catch {
        return new Response("Internal Server Error", { status: 500 });
      }
    }
    const slug = segments[0] ?? "";
    if (!slug) return notFoundResponse();

    if (segments.length > 1) return serveMedia(env, request, slug, segments.slice(1).join("/"));

    return serveAssetPage(env, request, url, slug);
  },
};

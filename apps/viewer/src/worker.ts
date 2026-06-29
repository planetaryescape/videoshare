import { D1Client } from "@effect/sql-d1";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import type { Chapter, Video } from "@videoshare/shared/Video";
import { Effect, Layer, Option } from "effect";
import playerCss from "../generated/player.css?raw";
import playerScript from "../generated/player.js?raw";
import { appleTouchIconBase64, favicon16Base64, favicon32Base64 } from "../generated/favicons";

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

const faviconLinks = `<link rel="icon" type="image/png" sizes="32x32" href="/_assets/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/_assets/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/_assets/apple-touch-icon.png">`;

const repositoryLayer = (env: ViewerEnv) =>
  VideoRepository.layerNoDeps.pipe(Layer.provide(D1Client.layer({ db: env.DB })));

const runRepository = <A>(env: ViewerEnv, effect: Effect.Effect<A, unknown, VideoRepository>) =>
  Effect.runPromise(effect.pipe(Effect.provide(repositoryLayer(env))));

const loadVideo = (env: ViewerEnv, slug: string) =>
  runRepository(
    env,
    Effect.gen(function* () {
      const repository = yield* VideoRepository;
      const videoOption = yield* repository.findBySlug(slug);
      if (Option.isNone(videoOption)) {
        return Option.none<{ readonly video: Video; readonly chapters: ReadonlyArray<Chapter> }>();
      }
      const video = videoOption.value;
      if (video.publishedAt === null) {
        return Option.none<{ readonly video: Video; readonly chapters: ReadonlyArray<Chapter> }>();
      }
      const chapters = yield* repository.listChapters(video.id);
      return Option.some({ video, chapters });
    }),
  );

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");

const sha256 = async (value: string) =>
  toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

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

const r2KeyDir = (key: string) => {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? "" : key.slice(0, slash + 1);
};

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

const ogTags = (origin: string, slug: string, video: Video) => {
  const pageUrl = `${origin}${mediaPrefix(slug).replace(/\/$/, "")}`;
  const imageUrl = absoluteUrl(origin, resolveMediaUrl(slug, video.posterKey));
  const description = video.description ?? "";
  const tags = [
    `<meta property="og:type" content="${video.kind === "audio" ? "music.song" : "video.other"}">`,
    `<meta property="og:title" content="${escapeHtml(video.title)}">`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
    `<meta property="og:site_name" content="VideoShare">`,
    `<meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(video.title)}">`,
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
  video: Video,
  chapters: ReadonlyArray<Chapter>,
) => {
  const isAudio = video.kind === "audio";
  const chaptersTrack = chaptersTrackFor(chapters);
  const posterUrl = resolveMediaUrl(slug, video.posterKey);
  const manifestUrl = resolveMediaUrl(slug, video.hlsKey);
  const chapterItems = chapters
    .map((chapter) => `<li>${escapeHtml(chapter.title)} <span>${chapter.startSec}s</span></li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(video.title)}</title>
    ${faviconLinks}
    ${ogTags(origin, slug, video)}
    <link rel="stylesheet" href="/_assets/player.css">
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: radial-gradient(circle at top, #1a1630, #09090f 52%); color: #f5f7fb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      main { width: min(1080px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0 64px; }
      h1 { margin: 24px 0 8px; font-size: clamp(2rem, 4vw, 3rem); }
      p { margin: 0; color: #b8c0d0; line-height: 1.6; }
      .player-shell { overflow: hidden; border-radius: 24px; background: #000; box-shadow: 0 24px 80px rgba(0,0,0,0.45); }
      media-player { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
      media-player[view-type="audio"] { aspect-ratio: auto; }
      media-video-layout { --media-brand: #7c5cff; --media-focus-ring-color: #9b87ff; }
      .meta { display: grid; gap: 24px; margin-top: 24px; }
      .chapters { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
      .chapters li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.05); color: #d7deea; }
      .slug { margin-top: 20px; font-size: 0.85rem; color: #8e98ab; }
    </style>
    <script type="module" src="/_assets/player.js"></script>
  </head>
  <body>
    <main>
      <div class="player-shell">
        <media-player
          title="${escapeHtml(video.title)}"
          src="${escapeHtml(manifestUrl ?? video.hlsKey)}"
          view-type="${isAudio ? "audio" : "video"}"
          stream-type="on-demand"
          playsinline
          crossorigin
          ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""}
        >
          <media-outlet>
            ${chaptersTrack ? `<track kind="chapters" src="${chaptersTrack}" default>` : ""}
          </media-outlet>
          <media-community-skin></media-community-skin>
        </media-player>
      </div>
      <div class="meta">
        <div>
          <h1>${escapeHtml(video.title)}</h1>
          <p>${escapeHtml(video.description ?? "")}</p>
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

const serveMedia = async (env: ViewerEnv, request: Request, slug: string, file: string) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (file.includes("..")) {
    return notFoundResponse();
  }

  const result = await loadVideo(env, slug);
  if (Option.isNone(result)) {
    return notFoundResponse();
  }

  const { video } = result.value;
  if (video.passwordHash && !isAuthorized(request, slug, video.passwordHash)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (isAbsoluteUrl(video.hlsKey)) {
    return notFoundResponse();
  }

  const key = `${r2KeyDir(video.hlsKey)}${file}`;
  const object = await env.BUCKET.get(key);
  if (!object) {
    return notFoundResponse();
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-type", object.httpMetadata?.contentType ?? r2ContentType(key));
  headers.set("cache-control", key.endsWith(".m3u8") ? "no-cache" : assetCacheControl);

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
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
    const slug = segments[0] ?? "";
    if (!slug) {
      return notFoundResponse();
    }

    if (segments.length > 1) {
      return serveMedia(env, request, slug, segments.slice(1).join("/"));
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const result = await loadVideo(env, slug);
      if (Option.isNone(result)) {
        return notFoundResponse();
      }

      const { video, chapters } = result.value;
      if (video.passwordHash) {
        if (request.method === "POST") {
          const formData = await request.formData();
          const password = formData.get("password");
          if (typeof password !== "string" || (await sha256(password)) !== video.passwordHash) {
            return new Response(passwordPage(slug, video.title, "Incorrect password."), {
              status: 403,
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }

          return new Response(null, {
            status: 303,
            headers: {
              location: url.toString(),
              "set-cookie": `${cookieName(slug)}=${video.passwordHash}; Max-Age=${cookieMaxAgeSeconds}; Path=/${slug}; HttpOnly; SameSite=Lax; Secure`,
            },
          });
        }

        if (!isAuthorized(request, slug, video.passwordHash)) {
          return new Response(passwordPage(slug, video.title), {
            status: 401,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
      }

      return new Response(viewerPage(url.origin, slug, video, chapters), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

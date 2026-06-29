import { SqliteClient } from "@effect/sql-sqlite-bun";
import { migrate } from "@videoshare/shared/Migrations";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { BunFileSystem } from "@effect/platform-bun";
import { registerMediabunnyServer } from "@mediabunny/server";
import { AdminApiLive, handlersLayer } from "./src/routes/AdminApiLive.ts";
import { ProgressBus } from "./src/services/ProgressBus.ts";
import { Transcoder } from "./src/services/Transcoder.ts";
import { Storage } from "./src/services/Storage.ts";
import { ProdSync } from "./src/prod.ts";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { makeProgressHandler, type ProgressSocketData } from "./src/ws/progress.ts";
import { corsMiddleware, mediaRouter } from "./src/routes/media.ts";

const dbFilename = process.env["VIDEOSHARE_DB"] ?? `${import.meta.dir}/videoshare-admin.db`;

registerMediabunnyServer();

const sqlLayer = SqliteClient.layer({ filename: dbFilename });
await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)));

// `Storage.layer` needs `FileSystem | Path`. `HttpServer.layerServices`
// provides `Path` and a no-op `FileSystem`; merge with the real
// `BunFileSystem.layer` so the platform services carry the Bun
// filesystem (right-most `FileSystem` wins in `Context.mergeAll`).
const platformLayer = Layer.merge(HttpServer.layerServices, BunFileSystem.layer);

const providedStorage = Storage.layer.pipe(Layer.provide(platformLayer));

const appLayer = Layer.mergeAll(
  sqlLayer,
  platformLayer,
  ProgressBus.layer,
  providedStorage,
  ProdSync.layer,
  VideoRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
  Transcoder.layer.pipe(Layer.provide(ProgressBus.layer), Layer.provide(providedStorage)),
);

// Build `appLayer` once via a `ManagedRuntime` so its resources (in
// particular the `SqliteClient` connection) stay alive for the lifetime
// of the server. Share that context between the HTTP handler and the
// WebSocket fiber so transcode progress events published via the
// `ProgressBus` reach subscribed sockets.
const appRuntime = ManagedRuntime.make(appLayer);
const appContext = await appRuntime.context();
const appContextLayer = Layer.succeedContext(appContext);

const fullLayer = Layer.mergeAll(handlersLayer, AdminApiLive, mediaRouter, corsMiddleware).pipe(
  Layer.provide(appContextLayer),
);

const { handler } = HttpRouter.toWebHandler(fullLayer, { disableLogger: false });

const progressRuntime = ManagedRuntime.make(ProgressBus.layer);
const progressHandler = makeProgressHandler(progressRuntime);

Bun.serve<ProgressSocketData>({
  port: 3001,
  maxRequestBodySize: 1024 * 1024 * 1024 * 5,
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      const videoId = new URL(req.url).searchParams.get("videoId");
      if (!videoId) return new Response("videoId required", { status: 400 });
      if (server.upgrade(req, { data: { videoId, fiber: null } })) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    }
    return handler(req, appContext);
  },
  websocket: {
    open(ws) {
      progressHandler.open(ws);
    },
    message() {},
    close(ws) {
      progressHandler.close(ws);
    },
  },
  error(error) {
    process.stderr.write(`Unhandled server error: ${String(error)}\n`);
    return new Response("Internal Server Error", { status: 500 });
  },
});

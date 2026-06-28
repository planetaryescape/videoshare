import { SqliteClient } from "@effect/sql-sqlite-bun";
import { migrate } from "@videoshare/shared/Migrations";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
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

// `Storage.layer` needs `FileSystem | Path` (provided by `HttpServer.layerServices`).
// `Transcoder.layer` depends on `Storage` and `ProgressBus`. We pre-resolve
// those inter-service dependencies with `.pipe(Layer.provide(...))` so
// `Layer.mergeAll` builds the sublayers independently.
const appLayer = Layer.mergeAll(
  sqlLayer,
  HttpServer.layerServices,
  ProgressBus.layer,
  Storage.layer.pipe(Layer.provide(HttpServer.layerServices)),
  ProdSync.layer,
  VideoRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
  Transcoder.layer.pipe(Layer.provide(ProgressBus.layer), Layer.provide(Storage.layer)),
);

const fullLayer = Layer.mergeAll(handlersLayer, AdminApiLive, mediaRouter, corsMiddleware).pipe(
  Layer.provide(appLayer),
);

// Build the layer once and share the resulting context between the HTTP
// handler and the WebSocket fiber so transcode progress events published
// via the AppLayer `ProgressBus` reach subscribed sockets.
const appRuntime = ManagedRuntime.make(fullLayer as never);
const { handler } = HttpRouter.toWebHandler(fullLayer as never, { disableLogger: true });

const progressHandler = makeProgressHandler(
  appRuntime as unknown as ManagedRuntime.ManagedRuntime<ProgressBus, never>,
);

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
    return handler(req);
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

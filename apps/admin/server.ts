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
import { makeProgressHandler } from "./src/ws/progress.ts";

const dbFilename = "./videoshare-admin.db";

registerMediabunnyServer();

const sqlLayer = SqliteClient.layer({ filename: dbFilename });
await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// `Storage.layer` and `VideoRepository.layerNoDeps` each need
// `FileSystem | Path` and `SqlClient` respectively. We pre-resolve those
// dependencies with `.pipe(Layer.provide(...))` so the merge below can
// assemble a flat `Layer<...>` without ordering constraints.
//
// `Transcoder.layer` depends on `Storage` and `ProgressBus`, so we pre-resolve
// those too. `Layer.mergeAll` builds sublayers independently, so any
// inter-service dependency must be collapsed before merging.
const appLayer = Layer.mergeAll(
  sqlLayer,
  HttpServer.layerServices,
  ProgressBus.layer,
  Storage.layer.pipe(Layer.provide(HttpServer.layerServices)),
  ProdSync.layer,
  VideoRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
  Transcoder.layer.pipe(Layer.provide(ProgressBus.layer), Layer.provide(Storage.layer)),
);

const fullLayer = Layer.mergeAll(handlersLayer, AdminApiLive).pipe(Layer.provide(appLayer));

// `as never` works around an Effect 4.0 type-narrowing gap: `Layer.mergeAll`
// returns a layer whose R union is too complex for `HttpRouter.toWebHandler`
// to accept, even though every service in the union is satisfied at runtime.
const { handler } = HttpRouter.toWebHandler(fullLayer as never, { disableLogger: true });

const progressRuntime = ManagedRuntime.make(ProgressBus.layer);
const progressHandler = makeProgressHandler(progressRuntime);

Bun.serve<{ videoId: string; fiber: unknown }>({
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
      progressHandler.open(ws as never);
    },
    message() {},
    close(ws) {
      progressHandler.close(ws as never);
    },
  },
  error(error) {
    process.stderr.write(`Unhandled server error: ${String(error)}\n`);
    return new Response("Internal Server Error", {
      status: 500,
      headers: corsHeaders,
    });
  },
});

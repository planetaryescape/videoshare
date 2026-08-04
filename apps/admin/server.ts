import { SqliteClient } from "@effect/sql-sqlite-bun";
import { migrate } from "@videoshare/shared/Migrations";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { registerMediabunnyServer } from "@mediabunny/server";
import { AdminApiLive, handlersLayer } from "./src/routes/AdminApiLive.ts";
import { AppLayer } from "./src/services/AppLayer.ts";
import { makeProgressHandler, type ProgressSocketData } from "./src/ws/progress.ts";
import { corsMiddleware, mediaRouter } from "./src/routes/media.ts";

const dbFilename = process.env["VIDEOSHARE_DB"] ?? `${import.meta.dir}/videoshare-admin.db`;

registerMediabunnyServer();

const sqlLayer = SqliteClient.layer({ filename: dbFilename });
await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)));

const appLayer = AppLayer;

// Build `appLayer` once via a `ManagedRuntime` so its resources stay alive for
// the server lifetime. Reuse its context for the WebSocket progress handler.
const appRuntime = ManagedRuntime.make(appLayer);
const appContext = await appRuntime.context();
const appContextLayer = Layer.succeedContext(appContext);

const fullLayer = Layer.mergeAll(handlersLayer, AdminApiLive, mediaRouter, corsMiddleware).pipe(
  Layer.provide(appContextLayer),
);

const { handler } = HttpRouter.toWebHandler(fullLayer, { disableLogger: false });

const progressRuntime = ManagedRuntime.make(Layer.succeedContext(appContext), {
  memoMap: appRuntime.memoMap,
});
const progressHandler = makeProgressHandler(progressRuntime);

Bun.serve<ProgressSocketData>({
  port: 3001,
  maxRequestBodySize: 1024 * 1024 * 1024 * 5,
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      const assetId = new URL(req.url).searchParams.get("assetId");
      if (!assetId) return new Response("assetId required", { status: 400 });
      if (server.upgrade(req, { data: { assetId, fiber: null } })) return undefined;
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

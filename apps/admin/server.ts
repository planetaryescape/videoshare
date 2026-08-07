import { SqliteClient } from "@effect/sql-sqlite-bun";
import { migrate } from "@videoshare/shared/Migrations";
import { Config, Effect, Layer, ManagedRuntime, Tracer } from "effect";
import { FetchHttpClient, HttpMiddleware, HttpRouter } from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import { registerMediabunnyServer } from "@mediabunny/server";
import { AdminApiLive, handlersLayer } from "./src/routes/AdminApiLive.ts";
import { makeAppLayer } from "./src/services/AppLayer.ts";
import { makeProgressHandler, type ProgressSocketData } from "./src/ws/progress.ts";
import { corsMiddleware, mediaRouter } from "./src/routes/media.ts";
import { makePrivacySafeTracer, traceHttpRequest } from "./src/services/Telemetry.ts";

const startupConfig = Config.all({
  dbFilename: Config.string("VIDEOSHARE_DB").pipe(
    Config.withDefault(`${import.meta.dir}/videoshare-admin.db`),
  ),
  telemetryServiceName: Config.string("OTEL_SERVICE_NAME").pipe(
    Config.withDefault("videoshare-admin"),
  ),
});
const { dbFilename, telemetryServiceName } = await Effect.runPromise(startupConfig);

registerMediabunnyServer();

const sqlLayer = SqliteClient.layer({ filename: dbFilename });
await Effect.runPromise(migrate.pipe(Effect.provide(sqlLayer)));

const telemetryExporterLayer = OtlpTracer.layerFromConfig({
  resource: {
    serviceName: telemetryServiceName,
    attributes: { "service.environment": "local" },
  },
}).pipe(Layer.provideMerge(Layer.merge(OtlpSerialization.layerProtobuf, FetchHttpClient.layer)));
const telemetryLayer = Layer.merge(
  Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true),
  Layer.effect(Tracer.Tracer, Effect.map(Tracer.Tracer, makePrivacySafeTracer)).pipe(
    Layer.provide(telemetryExporterLayer),
  ),
);
const appLayer = Layer.merge(makeAppLayer(sqlLayer), telemetryLayer);

// Build `appLayer` once via a `ManagedRuntime` so its resources stay alive for
// the server lifetime. Reuse its context for the WebSocket progress handler.
const appRuntime = ManagedRuntime.make(appLayer);
const appContext = await appRuntime.context();
const appContextLayer = Layer.succeedContext(appContext);

const apiLayer = AdminApiLive.pipe(Layer.provide(handlersLayer));
const fullLayer = Layer.mergeAll(apiLayer, mediaRouter, corsMiddleware).pipe(
  Layer.provide(appContextLayer),
);

const { handler } = HttpRouter.toWebHandler(fullLayer, {
  disableLogger: true,
  middleware: traceHttpRequest,
});

const progressRuntime = ManagedRuntime.make(Layer.succeedContext(appContext), {
  memoMap: appRuntime.memoMap,
});
const progressHandler = makeProgressHandler(progressRuntime);

Bun.serve<ProgressSocketData>({
  port: 3001,
  // Project publication uploads media and can exceed Bun's short default idle timeout.
  idleTimeout: 120,
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
  error() {
    process.stderr.write("Unhandled server error\n");
    return new Response("Internal Server Error", { status: 500 });
  },
});

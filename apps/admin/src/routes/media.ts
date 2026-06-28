import { Effect } from "effect";
import { HttpMiddleware, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import type { HttpServerRequest } from "effect/unstable/http";
import { Storage } from "../services/Storage.ts";

export const corsMiddleware = HttpRouter.middleware(
  HttpMiddleware.cors({
    allowedOrigins: ["*"],
    allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
  { global: true },
);

export const mediaRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    yield* router.add("GET", "/media/*", (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const url = new URL(request.url);
        const rel = decodeURIComponent(url.pathname.slice("/media/".length));
        const result = yield* storage.serveFile(rel);
        return HttpServerResponse.uint8Array(result.body, {
          contentType: result.contentType,
        });
      }),
    );
  }),
);

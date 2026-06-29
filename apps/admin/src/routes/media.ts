import { Effect } from "effect";
import { HttpMiddleware, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import type { HttpServerRequest } from "effect/unstable/http";
import { Storage } from "../services/Storage.ts";
import { StorageError } from "../errors/StorageErrors.ts";

export const corsMiddleware = HttpRouter.middleware(
  HttpMiddleware.cors({
    allowedOrigins: ["*"],
    allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
  { global: true },
);

const isNotFoundCause = (cause: unknown): boolean => {
  if (cause === null || typeof cause !== "object") return false;
  const c = cause as {
    _tag?: string;
    reason?: { _tag?: string } | string;
  };
  if (c._tag !== "PlatformError" && c._tag !== "SystemError") return false;
  const reason = c.reason;
  return typeof reason === "object" && reason !== null && reason._tag === "NotFound";
};

export const mediaRouter = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    yield* router.add("GET", "/media/*", (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const rel = yield* Effect.try({
          try: () => {
            const u = new URL(request.url, "http://localhost");
            return decodeURIComponent(u.pathname.slice("/media/".length));
          },
          catch: () => new StorageError({ operation: "parseUrl", cause: "bad-url" }),
        });
        const result = yield* storage.serveFile(rel).pipe(
          Effect.catchIf(
            (e) => e instanceof StorageError && isNotFoundCause(e.cause),
            () =>
              Effect.succeed({
                body: new Uint8Array(0),
                contentType: "text/plain",
                notFound: true as const,
              }),
          ),
        );
        if ("notFound" in result) {
          return HttpServerResponse.text("Not Found", { status: 404 });
        }
        return HttpServerResponse.uint8Array(result.body, {
          contentType: result.contentType,
        });
      }),
    );
  }),
);

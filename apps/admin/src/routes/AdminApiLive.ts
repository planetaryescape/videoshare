import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Layer } from "effect";
import { AdminApi } from "./AdminApi.ts";
import { VideosApiLive } from "./handlers/VideosApiLive.ts";
import { UploadApiLive } from "./handlers/UploadApiLive.ts";
import { PublishApiLive } from "./handlers/PublishApiLive.ts";
import { ChaptersApiLive } from "./handlers/ChaptersApiLive.ts";
import { AppLayer } from "../services/AppLayer.ts";

export const handlersLayer = Layer.mergeAll(
  VideosApiLive,
  UploadApiLive,
  PublishApiLive,
  ChaptersApiLive,
);

export const AdminApiLive = HttpApiBuilder.layer(AdminApi, {
  openapiPath: "/api/openapi.json",
}).pipe(Layer.provide(handlersLayer), Layer.provide(AppLayer));

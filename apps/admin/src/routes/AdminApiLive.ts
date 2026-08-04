import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Layer } from "effect";
import { AdminApi } from "./AdminApi.ts";
import { AssetsApiLive } from "./handlers/AssetsApiLive.ts";
import { UploadApiLive } from "./handlers/UploadApiLive.ts";
import { PublishApiLive } from "./handlers/PublishApiLive.ts";
import { ChaptersApiLive } from "./handlers/ChaptersApiLive.ts";
import { ProjectsApiLive } from "./handlers/ProjectsApiLive.ts";
import { AppLayer } from "../services/AppLayer.ts";

export const handlersLayer = Layer.mergeAll(
  AssetsApiLive,
  UploadApiLive,
  PublishApiLive,
  ChaptersApiLive,
  ProjectsApiLive,
);

export const AdminApiLive = HttpApiBuilder.layer(AdminApi, {
  openapiPath: "/api/openapi.json",
}).pipe(Layer.provide(handlersLayer), Layer.provide(AppLayer));

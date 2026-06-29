import { HttpApi } from "effect/unstable/httpapi";
import { ChaptersApi, PublishApi, UploadApi, VideosApi } from "./definitions/ApiGroups.ts";

export class AdminApi extends HttpApi.make("admin")
  .add(VideosApi)
  .add(UploadApi)
  .add(PublishApi)
  .add(ChaptersApi)
  .prefix("/api") {}

import { HttpApi } from "effect/unstable/httpapi";
import { ChaptersApi, PublishApi, UploadApi, AssetsApi } from "./definitions/ApiGroups.ts";

export class AdminApi extends HttpApi.make("admin")
  .add(AssetsApi)
  .add(UploadApi)
  .add(PublishApi)
  .add(ChaptersApi)
  .prefix("/api") {}

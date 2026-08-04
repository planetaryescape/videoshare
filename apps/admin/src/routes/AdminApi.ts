import { HttpApi } from "effect/unstable/httpapi";
import {
  ChaptersApi,
  PublishApi,
  UploadApi,
  AssetsApi,
  ProjectsApi,
} from "./definitions/ApiGroups.ts";

export class AdminApi extends HttpApi.make("admin")
  .add(AssetsApi)
  .add(ProjectsApi)
  .add(UploadApi)
  .add(PublishApi)
  .add(ChaptersApi)
  .prefix("/api") {}

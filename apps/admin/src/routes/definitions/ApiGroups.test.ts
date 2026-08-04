import { HttpApi } from "effect/unstable/httpapi";
import { expect, test } from "vitest";
import { AdminApi } from "../AdminApi";

test("exposes chapter replacement beneath the assets API prefix once", () => {
  const paths: Array<string> = [];

  HttpApi.reflect(AdminApi, {
    onGroup: () => undefined,
    onEndpoint: ({ endpoint }) => {
      if (endpoint.identifier === "replaceChapters") {
        paths.push(endpoint.path);
      }
    },
  });

  expect(paths).toEqual(["/api/assets/:assetId"]);
});

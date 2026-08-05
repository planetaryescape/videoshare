import { HttpApi } from "effect/unstable/httpapi";
import { expect, test } from "vitest";
import { AdminApi } from "../AdminApi";

test("does not declare multiple handlers for the same method and route shape", () => {
  const routeOwners = new Map<string, Array<string>>();

  HttpApi.reflect(AdminApi, {
    onGroup: () => undefined,
    onEndpoint: ({ endpoint }) => {
      const routeShape = endpoint.path.replaceAll(/:[^/]+/g, ":param");
      const routeKey = `${endpoint.method} ${routeShape}`;
      const owners = routeOwners.get(routeKey) ?? [];
      owners.push(endpoint.identifier);
      routeOwners.set(routeKey, owners);
    },
  });

  const duplicateRoutes = [...routeOwners]
    .filter(([, owners]) => owners.length > 1)
    .map(([route, owners]) => ({ route, owners }));

  expect(duplicateRoutes).toEqual([]);
});

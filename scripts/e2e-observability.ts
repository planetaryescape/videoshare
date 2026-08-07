import { Option, Schema } from "effect";
import {
  isObservableSpanName,
  isSafeTelemetryAttribute,
} from "../apps/admin/src/services/Telemetry.ts";

const adminOrigin = "http://127.0.0.1:3001";
// Caddy's loopback path routes avoid requiring Bun to trust the local development CA.
const tempoOrigin = "http://127.0.0.1/tempo";
const grafanaOrigin = "http://127.0.0.1/grafana";
const startedAt = Math.floor(Date.now() / 1000) - 2;

const TempoSearch = Schema.Struct({
  traces: Schema.optional(Schema.Array(Schema.Struct({ traceID: Schema.optional(Schema.String) }))),
});
const TempoTrace = Schema.Struct({
  batches: Schema.optional(
    Schema.Array(
      Schema.Struct({
        resource: Schema.optional(
          Schema.Struct({
            attributes: Schema.optional(
              Schema.Array(Schema.Struct({ key: Schema.optional(Schema.String) })),
            ),
          }),
        ),
        scopeSpans: Schema.optional(
          Schema.Array(
            Schema.Struct({
              spans: Schema.optional(
                Schema.Array(
                  Schema.Struct({
                    name: Schema.optional(Schema.String),
                    attributes: Schema.optional(
                      Schema.Array(Schema.Struct({ key: Schema.optional(Schema.String) })),
                    ),
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});
const GrafanaDashboard = Schema.Struct({
  dashboard: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      panels: Schema.optional(
        Schema.Array(
          Schema.Struct({
            type: Schema.optional(Schema.String),
            targets: Schema.optional(
              Schema.Array(Schema.Struct({ query: Schema.optional(Schema.String) })),
            ),
          }),
        ),
      ),
    }),
  ),
});

const decode = <A>(schema: Schema.Schema<A>, value: unknown, label: string): A => {
  const decoded = Schema.decodeUnknownOption(schema)(value);
  if (Option.isNone(decoded)) throw new Error(`${label} returned an unexpected payload`);
  return decoded.value;
};

const expectOk = async (response: Response, label: string) => {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return response;
};

await expectOk(await fetch(`${adminOrigin}/api/projects`), "admin list request");
const notFoundSentinel = "observability-validation-private-value";
const notFound = await fetch(`${adminOrigin}/api/projects/${notFoundSentinel}`);
if (notFound.status !== 404)
  throw new Error(`expected validation request to return 404, got ${notFound.status}`);

const searchUrl = () => {
  const url = new URL(`${tempoOrigin}/api/search`);
  url.searchParams.set(
    "q",
    '{ resource.service.name = "videoshare-admin" && name = "admin.http.request" && span.app.route = "projects.get" }',
  );
  url.searchParams.set("start", String(startedAt));
  url.searchParams.set("end", String(Math.floor(Date.now() / 1000) + 2));
  url.searchParams.set("limit", "10");
  return url;
};

let traceId: string | undefined;
for (let attempt = 0; attempt < 15; attempt += 1) {
  const response = await expectOk(await fetch(searchUrl()), "Tempo trace search");
  const payload = decode(TempoSearch, await response.json(), "Tempo trace search");
  traceId = payload.traces?.at(0)?.traceID;
  if (traceId !== undefined) break;
  await Bun.sleep(2_000);
}
if (traceId === undefined) throw new Error("Tempo did not return the validation trace");

const traceResponse = await expectOk(
  await fetch(`${tempoOrigin}/api/traces/${traceId}`),
  "Tempo trace retrieval",
);
const tracePayload = decode(TempoTrace, await traceResponse.json(), "Tempo trace retrieval");
const spans =
  tracePayload.batches?.flatMap(
    (batch) => batch.scopeSpans?.flatMap((scope) => scope.spans ?? []) ?? [],
  ) ?? [];
if (!spans.some((span) => span.name === "admin.http.request"))
  throw new Error("validation trace is missing its request root span");
const safeResourceAttributes = new Set(["service.name", "service.environment"]);
for (const batch of tracePayload.batches ?? []) {
  for (const attribute of batch.resource?.attributes ?? []) {
    if (attribute.key === undefined || !safeResourceAttributes.has(attribute.key))
      throw new Error(`unapproved resource attribute was exported: ${attribute.key ?? "unnamed"}`);
  }
}
for (const span of spans) {
  if (span.name === undefined || !isObservableSpanName(span.name))
    throw new Error(`unapproved span was exported: ${span.name ?? "unnamed"}`);
  for (const attribute of span.attributes ?? []) {
    if (attribute.key === undefined || !isSafeTelemetryAttribute(attribute.key))
      throw new Error(`unapproved attribute was exported: ${attribute.key ?? "unnamed"}`);
  }
}
const serializedTrace = JSON.stringify(tracePayload).toLowerCase();
for (const forbidden of [
  notFoundSentinel,
  "url.full",
  "url.path",
  "http.request.header",
  "db.query.text",
  "authorization",
  "cookie",
  "media/",
]) {
  if (serializedTrace.includes(forbidden))
    throw new Error(`trace contains forbidden data: ${forbidden}`);
}

const dashboardResponse = await expectOk(
  await fetch(`${grafanaOrigin}/api/dashboards/uid/videoshare-observability`),
  "Grafana dashboard lookup",
);
const dashboardPayload = decode(
  GrafanaDashboard,
  await dashboardResponse.json(),
  "Grafana dashboard lookup",
);
if (dashboardPayload.dashboard?.title !== "VideoShare Observability")
  throw new Error("Grafana returned the wrong dashboard");
const panels = dashboardPayload.dashboard.panels ?? [];
if (panels.length < 5)
  throw new Error(`expected at least five dashboard panels, got ${panels.length}`);

const now = Math.floor(Date.now() / 1000);
const metricsQueries = panels
  .filter((panel) => panel.type === "timeseries")
  .flatMap((panel) => panel.targets ?? [])
  .flatMap((target) => (target.query === undefined ? [] : [target.query]));
for (const query of metricsQueries) {
  const url = new URL(`${tempoOrigin}/api/metrics/query_range`);
  url.searchParams.set("q", query);
  url.searchParams.set("start", String(now - 3_600));
  url.searchParams.set("end", String(now));
  url.searchParams.set("step", "30s");
  await expectOk(await fetch(url), "Tempo dashboard metrics query");
}

process.stdout.write(
  `Observability validated: ${spans.length} safe span(s), ${panels.length} dashboard panels, ${metricsQueries.length} metrics queries.\n`,
);

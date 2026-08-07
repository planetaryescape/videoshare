# Observability

## Admin: local OTLP traces

The admin uses the shared local Caddy observability stack; it does not run its own collector. Start or verify it with:

```sh
cd ~/.config/caddy
just obs-up
~/.agents/skills/local-observability/scripts/status.sh
```

`.env` configures the Effect OTLP exporter for the canonical local Tempo endpoint:

```sh
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318
OTEL_SERVICE_NAME=videoshare-admin
```

Restart the admin server after changing these values. The exporter uses OTLP/HTTP protobuf.

### Dashboard

Open the provisioned [VideoShare Observability dashboard](https://grafana.localhost/d/videoshare-observability/videoshare-observability). It provides:

- request rate grouped by safe route category;
- failure rate grouped by safe route category or typed error;
- p95 operation latency;
- recent trace drill-down;
- project-publication trace drill-down.

Tempo's local-blocks processor supplies the TraceQL metrics used by the RED panels. Recent spans can take roughly one local-block flush interval to appear in those panels; trace search appears sooner.

### Trace model

`src/services/Telemetry.ts` is the telemetry boundary. It provides:

- one `admin.http.request` root span using categories such as `projects.publish`, never raw URLs;
- workflow spans for project/asset publication, unpublication, media processing, and media replacement;
- adapter spans for D1 and R2 work;
- `app.operation.outcome` and stable `error.type` classifications;
- console logs correlated with `trace.id` and `span.id`.

Framework HTTP tracing and SQL tracing are filtered from export because they attach headers, raw paths, and SQL text. Only approved span names and attribute keys are sampled. Failed span exits are replaced with a stable error classification before OTLP serialization, so raw dependency errors cannot enter Tempo.

Never attach passwords, cookies, slugs, media URLs or keys, request bodies, headers, SQL text, filenames, or raw dependency errors to telemetry. Add new fields to the typed allow-list only after confirming they are safe and bounded-cardinality.

### Validation

Run application checks and the shared-stack ingestion test:

```sh
bun run typecheck
bun test
~/.agents/skills/local-observability/scripts/smoke-trace.sh
bun run validate:observability
```

The telemetry tests assert route normalization, span filtering, safe error classification, and raw-cause removal. For an end-to-end check, invoke an admin endpoint and find the `videoshare-admin` service in Grafana.

## Viewer: Cloudflare Workers Traces

`alchemy.run.ts` currently enables Workers Traces with `headSamplingRate: 1`, so every Worker invocation is sampled and stored in Cloudflare Workers Observability.

Cloudflare's automatic instrumentation includes `url.full`, `url.path`, D1 query text, and R2 object keys. Those fields can contain VideoShare share slugs or media keys, and Cloudflare currently documents no per-field trace redaction control. This conflicts with the admin telemetry privacy policy above. Do not export these traces to the local Tempo stack or another destination until there is an explicit redaction design. Viewer traces remain in Cloudflare's account-scoped observability UI.

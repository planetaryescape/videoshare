import { Cause, Effect, Exit, Option, Tracer } from "effect";
import { HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";

export type ObservableSpanName =
  | "admin.http.request"
  | "admin.publish.project"
  | "admin.publish.asset"
  | "admin.unpublish.project"
  | "admin.unpublish.asset"
  | "admin.delete.project"
  | "admin.media.process"
  | "admin.media.replace"
  | "admin.cloud.d1.batch"
  | "admin.cloud.d1.query"
  | "admin.cloud.r2.upload-directory"
  | "admin.cloud.r2.marker-check"
  | "admin.cloud.r2.marker-invalidate"
  | "admin.cloud.r2.remove-prefix";

export const observableSpanNames: ReadonlySet<ObservableSpanName> = new Set([
  "admin.http.request",
  "admin.publish.project",
  "admin.publish.asset",
  "admin.unpublish.project",
  "admin.unpublish.asset",
  "admin.delete.project",
  "admin.media.process",
  "admin.media.replace",
  "admin.cloud.d1.batch",
  "admin.cloud.d1.query",
  "admin.cloud.r2.upload-directory",
  "admin.cloud.r2.marker-check",
  "admin.cloud.r2.marker-invalidate",
  "admin.cloud.r2.remove-prefix",
]);

export const isObservableSpanName = (name: string): name is ObservableSpanName => {
  switch (name) {
    case "admin.http.request":
    case "admin.publish.project":
    case "admin.publish.asset":
    case "admin.unpublish.project":
    case "admin.unpublish.asset":
    case "admin.delete.project":
    case "admin.media.process":
    case "admin.media.replace":
    case "admin.cloud.d1.batch":
    case "admin.cloud.d1.query":
    case "admin.cloud.r2.upload-directory":
    case "admin.cloud.r2.marker-check":
    case "admin.cloud.r2.marker-invalidate":
    case "admin.cloud.r2.remove-prefix":
      return true;
    default:
      return false;
  }
};

export type SafeTelemetryAttribute =
  | "app.route"
  | "app.operation.outcome"
  | "error.type"
  | "http.request.method"
  | "http.route"
  | "http.response.status_code"
  | "http.response.status_class"
  | "db.operation"
  | "db.statement_count"
  | "db.payload_bytes"
  | "storage.operation"
  | "storage.object_count"
  | "storage.payload_bytes"
  | "media.input_bytes"
  | "media.kind"
  | "publish.project_count"
  | "publish.asset_count"
  | "publish.upload_count";

export type SafeTelemetryAttributes = Partial<
  Record<SafeTelemetryAttribute, string | number | boolean>
>;

const safeTelemetryAttributes: ReadonlySet<string> = new Set([
  "app.route",
  "app.operation.outcome",
  "error.type",
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "http.response.status_class",
  "db.operation",
  "db.statement_count",
  "db.payload_bytes",
  "storage.operation",
  "storage.object_count",
  "storage.payload_bytes",
  "media.input_bytes",
  "media.kind",
  "publish.project_count",
  "publish.asset_count",
  "publish.upload_count",
]);

export const isSafeTelemetryAttribute = (key: string): key is SafeTelemetryAttribute =>
  safeTelemetryAttributes.has(key);

type OperationOutcome = "success" | "failure" | "interrupted";

type TraceOptions<A> = {
  readonly kind?: Tracer.SpanKind;
  readonly log?: "always" | "failure" | "never";
  readonly outcome?: (value: A) => Exclude<OperationOutcome, "interrupted">;
  readonly successAttributes?: (value: A) => SafeTelemetryAttributes;
};

const safeErrorType = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const tag = Reflect.get(error, "_tag");
    if (typeof tag === "string") return tag;
    if (error instanceof Error && error.name !== "") return error.name;
  }
  return "UnknownError";
};

const failureDetails = <E>(
  cause: Cause.Cause<E>,
): { readonly outcome: "failure" | "interrupted"; readonly errorType: string } => {
  if (Cause.hasInterruptsOnly(cause)) return { outcome: "interrupted", errorType: "Interrupted" };
  const error = Cause.findErrorOption(cause);
  return {
    outcome: "failure",
    errorType: Option.isSome(error) ? safeErrorType(error.value) : "Defect",
  };
};

const correlatedLog = (
  level: "info" | "error",
  name: ObservableSpanName,
  outcome: OperationOutcome,
  attributes: SafeTelemetryAttributes,
  errorType?: string,
) =>
  Effect.flatMap(Effect.currentSpan, (span) => {
    const annotations = {
      "trace.id": span.traceId,
      "span.id": span.spanId,
      "app.operation": name,
      "app.operation.outcome": outcome,
      ...attributes,
      ...(errorType === undefined ? {} : { "error.type": errorType }),
    };
    const log =
      level === "error"
        ? Effect.logError("Observed operation failed")
        : Effect.logInfo("Observed operation completed");
    return Effect.annotateLogs(log, annotations);
  }).pipe(Effect.ignore);

const recordExit = <A, E>(
  name: ObservableSpanName,
  attributes: SafeTelemetryAttributes,
  exit: Exit.Exit<A, E>,
  options: TraceOptions<A>,
) => {
  if (Exit.isSuccess(exit)) {
    const outcome = options.outcome?.(exit.value) ?? "success";
    const successAttributes = options.successAttributes?.(exit.value) ?? {};
    const completedAttributes = { ...attributes, ...successAttributes };
    return Effect.andThen(
      Effect.annotateCurrentSpan({
        "app.operation.outcome": outcome,
        ...successAttributes,
      }),
      options.log === "always"
        ? correlatedLog(
            outcome === "failure" ? "error" : "info",
            name,
            outcome,
            completedAttributes,
          )
        : Effect.void,
    );
  }
  const { outcome, errorType } = failureDetails(exit.cause);
  return Effect.andThen(
    Effect.annotateCurrentSpan({
      "app.operation.outcome": outcome,
      "error.type": errorType,
    }),
    options.log === "never"
      ? Effect.void
      : correlatedLog("error", name, outcome, attributes, errorType),
  );
};

/** Traces one approved operation and emits only explicitly safe attributes and error classifications. */
export const trace = <A, E, R>(
  name: ObservableSpanName,
  attributes: SafeTelemetryAttributes,
  effect: Effect.Effect<A, E, R>,
  options: TraceOptions<A> = {},
): Effect.Effect<A, E, R> =>
  Effect.onExit(effect, (exit) => recordExit(name, attributes, exit, options)).pipe(
    Effect.withSpan(name, { attributes, kind: options.kind }),
  );

/** Adds approved fields computed during an operation to its current span. */
export const annotate = (attributes: SafeTelemetryAttributes): Effect.Effect<void> =>
  Effect.annotateCurrentSpan(attributes);

const routePatterns: ReadonlyArray<{
  readonly method: string;
  readonly pattern: RegExp;
  readonly category: string;
}> = [
  { method: "GET", pattern: /^\/api\/assets\/?$/, category: "assets.list" },
  { method: "POST", pattern: /^\/api\/assets\/?$/, category: "assets.create" },
  { method: "GET", pattern: /^\/api\/assets\/[^/]+\/?$/, category: "assets.get" },
  { method: "PUT", pattern: /^\/api\/assets\/[^/]+\/?$/, category: "assets.update" },
  { method: "DELETE", pattern: /^\/api\/assets\/[^/]+\/?$/, category: "assets.delete" },
  { method: "GET", pattern: /^\/api\/projects\/?$/, category: "projects.list" },
  { method: "POST", pattern: /^\/api\/projects\/?$/, category: "projects.create" },
  { method: "GET", pattern: /^\/api\/projects\/[^/]+\/?$/, category: "projects.get" },
  { method: "PUT", pattern: /^\/api\/projects\/[^/]+\/?$/, category: "projects.update" },
  { method: "DELETE", pattern: /^\/api\/projects\/[^/]+\/?$/, category: "projects.delete" },
  {
    method: "PUT",
    pattern: /^\/api\/projects\/[^/]+\/members\/?$/,
    category: "projects.members.replace",
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/[^/]+\/members\/?$/,
    category: "projects.members.move",
  },
  {
    method: "DELETE",
    pattern: /^\/api\/projects\/[^/]+\/members\/[^/]+\/?$/,
    category: "projects.members.unfile",
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/[^/]+\/publish\/?$/,
    category: "projects.publish",
  },
  {
    method: "DELETE",
    pattern: /^\/api\/projects\/[^/]+\/publish\/?$/,
    category: "projects.unpublish",
  },
  { method: "POST", pattern: /^\/api\/upload\/?$/, category: "media.upload" },
  { method: "POST", pattern: /^\/api\/publish\/[^/]+\/?$/, category: "assets.publish" },
  {
    method: "POST",
    pattern: /^\/api\/publish\/[^/]+\/unpublish\/?$/,
    category: "assets.unpublish",
  },
  { method: "GET", pattern: /^\/api\/openapi\.json$/, category: "api.openapi" },
  { method: "GET", pattern: /^\/media\//, category: "media.read" },
];

export const routeCategory = (method: string, path: string): string =>
  routePatterns.find((route) => route.method === method && route.pattern.test(path))?.category ??
  "unknown";

const statusClass = (status: number): string => `${Math.floor(status / 100)}xx`;

/** Root request span using a route category; raw URLs, parameters, queries and headers never enter telemetry. */
export const traceHttpRequest = <E, R>(
  app: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  >,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URL(request.url, "http://localhost").pathname;
    const attributes: SafeTelemetryAttributes = {
      "app.route": routeCategory(request.method, path),
      "http.request.method": request.method,
    };
    return yield* trace("admin.http.request", attributes, app, {
      kind: "server",
      log: "always",
      outcome: (response) => (response.status >= 400 ? "failure" : "success"),
      successAttributes: (response) => ({
        "http.response.status_code": response.status,
        "http.response.status_class": statusClass(response.status),
      }),
    });
  });

const sanitizeExit = <A, E>(exit: Exit.Exit<A, E>): Exit.Exit<A, string> => {
  if (Exit.isSuccess(exit)) return Exit.succeed(exit.value);
  const { outcome, errorType } = failureDetails(exit.cause);
  return Exit.fail(`${outcome}:${errorType}`);
};

const wrapSpan = (span: Tracer.Span): Tracer.Span => ({
  get _tag() {
    return span._tag;
  },
  get name() {
    return span.name;
  },
  get spanId() {
    return span.spanId;
  },
  get traceId() {
    return span.traceId;
  },
  get parent() {
    return span.parent;
  },
  get annotations() {
    return span.annotations;
  },
  get status() {
    return span.status;
  },
  get attributes() {
    return span.attributes;
  },
  get links() {
    return span.links;
  },
  get sampled() {
    return span.sampled;
  },
  get kind() {
    return span.kind;
  },
  end: (endTime, exit) => span.end(endTime, sanitizeExit(exit)),
  attribute: (key, value) => {
    if (isSafeTelemetryAttribute(key)) span.attribute(key, value);
  },
  event: () => undefined,
  addLinks: () => undefined,
});

/** Drops framework/internal spans and ensures exported failures cannot serialize raw causes. */
export const makePrivacySafeTracer = (tracer: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span: (options) =>
      wrapSpan(
        tracer.span({
          ...options,
          links: [],
          sampled: options.sampled && isObservableSpanName(options.name),
        }),
      ),
    context: tracer.context,
  });

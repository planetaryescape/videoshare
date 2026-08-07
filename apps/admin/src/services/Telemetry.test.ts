import { describe, expect, test } from "vitest";
import { Cause, Context, Effect, Exit, Option, Tracer } from "effect";
import {
  makePrivacySafeTracer,
  routeCategory,
  trace,
  type ObservableSpanName,
} from "./Telemetry.ts";

interface RecordedSpan {
  readonly name: string;
  readonly sampled: boolean;
  readonly attributes: Map<string, unknown>;
  exit?: Exit.Exit<unknown, unknown>;
}

const recordingTracer = () => {
  const spans: Array<RecordedSpan> = [];
  let sequence = 0;
  const tracer = Tracer.make({
    span: (options) => {
      const recorded: RecordedSpan = {
        name: options.name,
        sampled: options.sampled,
        attributes: new Map(),
      };
      spans.push(recorded);
      const startedAt = options.startTime;
      let status: Tracer.SpanStatus = { _tag: "Started", startTime: startedAt };
      const span: Tracer.Span = {
        _tag: "Span",
        name: options.name,
        spanId: String(++sequence).padStart(16, "0"),
        traceId: "0".repeat(32),
        parent: options.parent,
        annotations: options.annotations,
        get status() {
          return status;
        },
        attributes: recorded.attributes,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        end: (endTime, exit) => {
          recorded.exit = exit;
          status = { _tag: "Ended", startTime: startedAt, endTime, exit };
        },
        attribute: (key, value) => recorded.attributes.set(key, value),
        event: () => undefined,
        addLinks: () => undefined,
      };
      return span;
    },
  });
  return { tracer, spans };
};

const spanOptions = (name: string): Parameters<Tracer.Tracer["span"]>[0] => ({
  name,
  parent: Option.none(),
  annotations: Context.empty(),
  links: [],
  startTime: 1n,
  kind: "internal",
  root: true,
  sampled: true,
});

describe("privacy-safe telemetry", () => {
  test("exports approved spans with safe outcome and error classification", async () => {
    const recording = recordingTracer();
    const tracer = makePrivacySafeTracer(recording.tracer);

    await Effect.runPromise(
      trace(
        "admin.publish.project",
        { "publish.asset_count": 3 },
        Effect.fail({ _tag: "ProdSyncError", cause: new Error("secret dependency response") }),
        { log: "never" },
      ).pipe(Effect.exit, Effect.provideService(Tracer.Tracer, tracer)),
    );

    const span = recording.spans.at(0);
    expect(span?.sampled).toBe(true);
    expect(span?.attributes.get("publish.asset_count")).toBe(3);
    expect(span?.attributes.get("app.operation.outcome")).toBe("failure");
    expect(span?.attributes.get("error.type")).toBe("ProdSyncError");
    expect(span?.exit && Exit.isFailure(span.exit)).toBe(true);
    const rendered =
      span?.exit && Exit.isFailure(span.exit) ? Cause.pretty(span.exit.cause) : "missing failure";
    expect(rendered).toContain("failure:ProdSyncError");
    expect(rendered).not.toContain("secret dependency response");
  });

  test("does not sample framework or SQL spans", () => {
    const recording = recordingTracer();
    const tracer = makePrivacySafeTracer(recording.tracer);

    tracer.span(spanOptions("sql.execute"));
    const requestSpan = tracer.span(spanOptions("admin.http.request" satisfies ObservableSpanName));
    requestSpan.attribute("app.route", "projects.list");
    requestSpan.attribute("http.request.header.authorization", "secret bearer token");

    expect(recording.spans.at(1)?.attributes).toEqual(new Map([["app.route", "projects.list"]]));
    expect(recording.spans.map(({ name, sampled }) => ({ name, sampled }))).toEqual([
      { name: "sql.execute", sampled: false },
      { name: "admin.http.request", sampled: true },
    ]);
  });
});

describe("safe route categories", () => {
  test("classifies routes without retaining identifiers, query strings or slugs", () => {
    expect(routeCategory("POST", "/api/projects/private-project-id/publish")).toBe(
      "projects.publish",
    );
    expect(
      routeCategory("DELETE", "/api/projects/private-project-id/members/private-asset-id"),
    ).toBe("projects.members.unfile");
    expect(routeCategory("GET", "/media/private-project-slug/master.m3u8")).toBe("media.read");
    expect(routeCategory("GET", "/not-a-route/private-value")).toBe("unknown");
  });
});

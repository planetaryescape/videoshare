import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect";

export const ProgressEvent = Schema.Struct({
  videoId: Schema.String,
  stage: Schema.String,
  pct: Schema.Number,
});
export type ProgressEvent = typeof ProgressEvent.Type;

export interface ProgressBusService {
  readonly publish: (event: ProgressEvent) => Effect.Effect<void>;
  readonly subscribe: (videoId: string) => Stream.Stream<ProgressEvent>;
}

export class ProgressBus extends Context.Service<ProgressBus, ProgressBusService>()(
  "admin/ProgressBus",
) {
  static readonly layer: Layer.Layer<ProgressBus> = Layer.effect(
    ProgressBus,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.bounded<ProgressEvent>(64);

      return ProgressBus.of({
        publish: (event) => PubSub.publish(pubsub, event),
        subscribe: (videoId) =>
          Stream.fromPubSub(pubsub).pipe(Stream.filter((e) => e.videoId === videoId)),
      });
    }),
  );
}

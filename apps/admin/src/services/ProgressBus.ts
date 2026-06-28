import { Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect";

export const ProgressEvent = Schema.Struct({
  videoId: Schema.String,
  stage: Schema.String,
  pct: Schema.Number,
});
export type ProgressEvent = typeof ProgressEvent.Type;

const CHANNEL_BUFFER = 64;

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
      const channels = yield* Ref.make(new Map<string, PubSub.PubSub<ProgressEvent>>());

      const getOrCreate = (videoId: string): Effect.Effect<PubSub.PubSub<ProgressEvent>> =>
        Ref.get(channels).pipe(
          Effect.flatMap((map) => {
            const existing = map.get(videoId);
            if (existing) return Effect.succeed(existing);
            return PubSub.bounded<ProgressEvent>(CHANNEL_BUFFER).pipe(
              Effect.tap((ps) =>
                Ref.update(channels, (m) => {
                  const next = new Map(m);
                  next.set(videoId, ps);
                  return next;
                }),
              ),
            );
          }),
        );

      return ProgressBus.of({
        publish: (event) =>
          Effect.gen(function* () {
            const map = yield* Ref.get(channels);
            const channel = map.get(event.videoId);
            if (channel) {
              yield* PubSub.publish(channel, event);
            }
          }),
        subscribe: (videoId) =>
          Stream.unwrap(getOrCreate(videoId).pipe(Effect.map((ps) => Stream.fromPubSub(ps)))),
      });
    }),
  );
}

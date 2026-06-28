import { Context, Effect, Layer, PubSub, Ref, Schema, Semaphore, Stream } from "effect";

export const ProgressEvent = Schema.Struct({
  videoId: Schema.String,
  stage: Schema.String,
  pct: Schema.Number,
});
export type ProgressEvent = typeof ProgressEvent.Type;

const CHANNEL_BUFFER = 64;

type Channel = {
  readonly pubsub: PubSub.PubSub<ProgressEvent>;
  readonly subscribers: number;
};

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
      const channels = yield* Ref.make(new Map<string, Channel>());
      const lock = yield* Semaphore.make(1);

      const acquire = (videoId: string) =>
        Semaphore.withPermit(
          lock,
          Effect.gen(function* () {
            const map = yield* Ref.get(channels);
            const existing = map.get(videoId);
            if (existing) {
              yield* Ref.update(channels, (m) =>
                new Map(m).set(videoId, {
                  pubsub: existing.pubsub,
                  subscribers: existing.subscribers + 1,
                }),
              );
              return existing.pubsub;
            }
            const pubsub = yield* PubSub.bounded<ProgressEvent>(CHANNEL_BUFFER);
            yield* Ref.update(channels, (m) => new Map(m).set(videoId, { pubsub, subscribers: 1 }));
            return pubsub;
          }),
        );

      const release = (videoId: string) =>
        Semaphore.withPermit(
          lock,
          Effect.gen(function* () {
            const map = yield* Ref.get(channels);
            const existing = map.get(videoId);
            if (!existing) return;
            if (existing.subscribers === 1) {
              yield* PubSub.shutdown(existing.pubsub);
              yield* Ref.update(channels, (m) => {
                const next = new Map(m);
                next.delete(videoId);
                return next;
              });
              return;
            }
            yield* Ref.update(channels, (m) =>
              new Map(m).set(videoId, {
                pubsub: existing.pubsub,
                subscribers: existing.subscribers - 1,
              }),
            );
          }),
        );

      return ProgressBus.of({
        publish: (event) =>
          Effect.gen(function* () {
            const map = yield* Ref.get(channels);
            const channel = map.get(event.videoId);
            if (channel) {
              yield* PubSub.publish(channel.pubsub, event);
            }
          }),
        subscribe: (videoId) =>
          Stream.unwrap(
            acquire(videoId).pipe(
              Effect.map((pubsub) =>
                Stream.fromPubSub(pubsub).pipe(Stream.ensuring(release(videoId))),
              ),
            ),
          ),
      });
    }),
  );
}

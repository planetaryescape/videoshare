import { Context, Effect, Layer, PubSub, Ref, Schema, Semaphore, Stream } from "effect";

export const ProgressEvent = Schema.Struct({
  assetId: Schema.String,
  stage: Schema.String,
  pct: Schema.Finite,
});
export type ProgressEvent = typeof ProgressEvent.Type;

const CHANNEL_BUFFER = 64;

type Channel = {
  readonly pubsub: PubSub.PubSub<ProgressEvent>;
  readonly subscribers: number;
};

export interface ProgressBusService {
  readonly publish: (event: ProgressEvent) => Effect.Effect<void>;
  readonly subscribe: (assetId: string) => Stream.Stream<ProgressEvent>;
}

export class ProgressBus extends Context.Service<ProgressBus, ProgressBusService>()(
  "admin/ProgressBus",
) {
  static readonly layer: Layer.Layer<ProgressBus> = Layer.effect(
    ProgressBus,
    Effect.gen(function* () {
      const channels = yield* Ref.make(new Map<string, Channel>());
      const lock = yield* Semaphore.make(1);

      const acquire = (assetId: string) =>
        Semaphore.withPermit(
          lock,
          Effect.gen(function* () {
            const map = yield* Ref.get(channels);
            const existing = map.get(assetId);
            if (existing) {
              yield* Ref.update(channels, (m) =>
                new Map(m).set(assetId, {
                  pubsub: existing.pubsub,
                  subscribers: existing.subscribers + 1,
                }),
              );
              return existing.pubsub;
            }
            const pubsub = yield* PubSub.bounded<ProgressEvent>(CHANNEL_BUFFER);
            yield* Ref.update(channels, (m) => new Map(m).set(assetId, { pubsub, subscribers: 1 }));
            return pubsub;
          }),
        );

      const release = (assetId: string) =>
        Semaphore.withPermit(
          lock,
          Effect.gen(function* () {
            const map = yield* Ref.get(channels);
            const existing = map.get(assetId);
            if (!existing) return;
            if (existing.subscribers === 1) {
              yield* PubSub.shutdown(existing.pubsub);
              yield* Ref.update(channels, (m) => {
                const next = new Map(m);
                next.delete(assetId);
                return next;
              });
              return;
            }
            yield* Ref.update(channels, (m) =>
              new Map(m).set(assetId, {
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
            const channel = map.get(event.assetId);
            if (channel) {
              yield* PubSub.publish(channel.pubsub, event);
            }
          }),
        subscribe: (assetId) =>
          Stream.unwrap(
            acquire(assetId).pipe(
              Effect.map((pubsub) =>
                Stream.fromPubSub(pubsub).pipe(Stream.ensuring(release(assetId))),
              ),
            ),
          ),
      });
    }),
  );
}

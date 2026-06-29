import { Effect, Queue, Stream } from "effect";
import { Subscription } from "foldkit";
import type { Model as ModelSchema } from "./model";
import type { Message as MessageSchema } from "./message";
import { PROGRESS_EVENT } from "./update";

type Model = ModelSchema;
type Message = MessageSchema;

export const subscriptions = Subscription.make<Model, Message>()(() => ({
  uploadProgress: Subscription.persistent(
    Stream.callback<Message>((queue) =>
      Effect.gen(function* () {
        const handler = (event: Event) => {
          const detail = (event as CustomEvent<Message>).detail;
          Queue.offerUnsafe(queue, detail);
        };
        window.addEventListener(PROGRESS_EVENT, handler);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            window.removeEventListener(PROGRESS_EVENT, handler);
          }),
        );
      }),
    ),
  ),
}));

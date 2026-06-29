import { Effect, Queue, Stream } from "effect";
import { Subscription } from "foldkit";
import type { Model as ModelSchema } from "./model";
import type { Message as MessageSchema } from "./message";
import { PROGRESS_EVENT } from "./update";

type Model = ModelSchema;
type Message = MessageSchema;

const isMessageEvent = (event: Event): event is CustomEvent<Message> =>
  event instanceof CustomEvent;

export const subscriptions = Subscription.make<Model, Message>()(() => ({
  uploadProgress: Subscription.persistent(
    Stream.callback<Message>((queue) =>
      Effect.gen(function* () {
        const handler = (event: Event) => {
          if (!isMessageEvent(event)) return;
          Queue.offerUnsafe(queue, event.detail);
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

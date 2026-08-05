import type { ServerWebSocket } from "bun";
import { Effect, Fiber, Stream } from "effect";
import type { ManagedRuntime } from "effect";
import { ProgressBus } from "../services/ProgressBus.ts";

export interface ProgressSocketData {
  readonly assetId: string;
  fiber: Fiber.Fiber<void, never> | null;
}

export const makeProgressHandler = (
  runtime: ManagedRuntime.ManagedRuntime<ProgressBus, never>,
) => ({
  open(ws: ServerWebSocket<ProgressSocketData>) {
    const program = Effect.gen(function* () {
      const progress = yield* ProgressBus;
      yield* progress.subscribe(ws.data.assetId).pipe(
        Stream.runForEach((event) =>
          Effect.try({
            try: () => ws.send(JSON.stringify(event)),
            catch: () => undefined,
          }).pipe(Effect.orDie),
        ),
      );
    });
    ws.data.fiber = runtime.runFork(program);
  },
  close(ws: ServerWebSocket<ProgressSocketData>) {
    const fiber = ws.data.fiber;
    if (fiber) {
      runtime.runFork(Fiber.interrupt(fiber));
      ws.data.fiber = null;
    }
  },
});

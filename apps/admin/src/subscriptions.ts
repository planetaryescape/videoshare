import { Effect, Option, Queue, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";
import { FailedUploadProgress, ReceivedUploadProgress, type Message } from "./message";
import type { Model } from "./model";

const ProgressFrame = S.Struct({
  stage: S.String,
  pct: S.Finite.check(S.isBetween({ minimum: 0, maximum: 100 })),
});

const decodeFrame = S.decodeUnknownOption(S.fromJsonString(ProgressFrame));

const uploadProgressStream = (videoId: string): Stream.Stream<Message> =>
  Stream.callback<Message>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const socket = new WebSocket(
          `ws://${location.hostname}:3001/ws?videoId=${encodeURIComponent(videoId)}`,
        );
        let isTerminated = false;

        const terminate = (error: string) => {
          if (isTerminated) {
            return;
          }
          isTerminated = true;
          Queue.offerUnsafe(queue, FailedUploadProgress({ error }));
          Queue.endUnsafe(queue);
        };

        const handleMessage = (event: MessageEvent) => {
          const decoded = decodeFrame(event.data);
          if (Option.isSome(decoded)) {
            Queue.offerUnsafe(
              queue,
              ReceivedUploadProgress({
                stage: decoded.value.stage,
                pct: decoded.value.pct,
              }),
            );
          }
        };
        const handleClose = () => terminate("Upload progress connection closed");
        const handleError = () => terminate("Upload progress connection failed");

        socket.addEventListener("message", handleMessage);
        socket.addEventListener("close", handleClose);
        socket.addEventListener("error", handleError);

        return { socket, handleMessage, handleClose, handleError };
      }),
      ({ socket, handleMessage, handleClose, handleError }) =>
        Effect.sync(() => {
          socket.removeEventListener("message", handleMessage);
          socket.removeEventListener("close", handleClose);
          socket.removeEventListener("error", handleError);
          socket.close();
        }),
    ).pipe(Effect.flatMap(() => Effect.never)),
  );

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  uploadProgress: entry(
    { maybeUploadingVideoId: S.Option(S.String) },
    {
      modelToDependencies: (model) => ({
        maybeUploadingVideoId: model.uploadingVideoId,
      }),
      dependenciesToStream: ({ maybeUploadingVideoId }) =>
        Option.match(maybeUploadingVideoId, {
          onNone: () => Stream.empty,
          onSome: uploadProgressStream,
        }),
    },
  ),
}));

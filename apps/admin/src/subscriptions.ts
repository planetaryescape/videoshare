import { Effect, Option, Queue, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { Model as ModelSchema } from './model'
import { Message as MessageSchema, ReceivedUploadProgress } from './message'

type Model = S.Schema.Type<typeof ModelSchema>
type Message = S.Schema.Type<typeof MessageSchema>

const SERVER_ORIGIN = `http://${location.hostname}:3001`
const WS_ORIGIN = SERVER_ORIGIN.replace(/^http/, 'ws')

const FrameSchema = S.Struct({ stage: S.String, pct: S.Number })
const decodeJson = S.decodeUnknownOption(S.fromJsonString(FrameSchema))

const decodeFrame = (raw: unknown): Option.Option<Message> =>
  Option.map(decodeJson(raw), (frame) =>
    ReceivedUploadProgress({ stage: frame.stage, pct: frame.pct }),
  )

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  uploadProgress: entry(
    { uploadVideoId: S.String },
    {
      modelToDependencies: (model): { uploadVideoId: string } => ({
        uploadVideoId:
          model.isUploading && model.screen._tag === 'EditVideo'
            ? model.screen.videoId
            : '',
      }),
      dependenciesToStream: ({ uploadVideoId }): Stream.Stream<Message> => {
        if (uploadVideoId === '') {
          return Stream.empty
        }
        return Stream.callback<Message>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const ws = new WebSocket(
                `${WS_ORIGIN}/ws?videoId=${encodeURIComponent(uploadVideoId)}`,
              )
              ws.onmessage = (event) => {
                const decoded = decodeFrame(event.data)
                if (Option.isSome(decoded)) {
                  Queue.offerUnsafe(queue, decoded.value)
                }
              }
              return ws
            }),
            (ws) => Effect.sync(() => ws.close()),
          ),
        )
      },
    },
  ),
}))

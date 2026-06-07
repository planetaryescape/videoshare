import { Schema as S, Match as M, Effect, Option } from 'effect'
import { Command } from 'foldkit'
import { html } from 'foldkit/html'
import { evo } from 'foldkit/struct'
import { m } from 'foldkit/message'

type Video = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly description: string | null
  readonly posterKey: string | null
  readonly hlsKey: string
  readonly durationSec: number
  readonly createdAt: number
  readonly publishedAt: number | null
}

const VideoSchema = S.Struct({
  id: S.String,
  slug: S.String,
  title: S.String,
  description: S.NullOr(S.String),
  posterKey: S.NullOr(S.String),
  hlsKey: S.String,
  durationSec: S.Number,
  createdAt: S.Number,
  publishedAt: S.NullOr(S.Number),
})

export const ClickedNewVideo = m('ClickedNewVideo')
export const ClickedEditVideo = m('ClickedEditVideo', { id: S.String })
export const ClickedBack = m('ClickedBack')
export const UpdatedTitle = m('UpdatedTitle', { title: S.String })
export const UpdatedDescription = m('UpdatedDescription', { description: S.String })
export const SubmittedCreateVideo = m('SubmittedCreateVideo')
export const SucceededCreateVideo = m('SucceededCreateVideo', { video: VideoSchema })
export const FailedCreateVideo = m('FailedCreateVideo', { error: S.String })
export const SucceededLoadVideos = m('SucceededLoadVideos', { videos: S.Array(VideoSchema) })
export const FailedLoadVideos = m('FailedLoadVideos', { error: S.String })
export const SelectedFile = m('SelectedFile', { file: S.Any })
export const SubmittedUpload = m('SubmittedUpload')
export const SucceededUpload = m('SucceededUpload', { video: VideoSchema })
export const FailedUpload = m('FailedUpload', { error: S.String })
export const ClickedPublish = m('ClickedPublish', { id: S.String })
export const SucceededPublish = m('SucceededPublish', { video: VideoSchema })
export const FailedPublish = m('FailedPublish', { error: S.String })
export const ClickedDeleteVideo = m('ClickedDeleteVideo', { id: S.String })
export const SucceededDeleteVideo = m('SucceededDeleteVideo', { id: S.String })
export const FailedDeleteVideo = m('FailedDeleteVideo', { error: S.String })
export const SucceededLoadVideoDetail = m('SucceededLoadVideoDetail', { video: VideoSchema })
export const FailedLoadVideoDetail = m('FailedLoadVideoDetail', { error: S.String })

export const Message = S.Union([
  ClickedNewVideo,
  ClickedEditVideo,
  ClickedBack,
  UpdatedTitle,
  UpdatedDescription,
  SubmittedCreateVideo,
  SucceededCreateVideo,
  FailedCreateVideo,
  SucceededLoadVideos,
  FailedLoadVideos,
  SelectedFile,
  SubmittedUpload,
  SucceededUpload,
  FailedUpload,
  ClickedPublish,
  SucceededPublish,
  FailedPublish,
  ClickedDeleteVideo,
  SucceededDeleteVideo,
  FailedDeleteVideo,
  SucceededLoadVideoDetail,
  FailedLoadVideoDetail,
])
export type Message = S.Schema.Type<typeof Message>

export const Model = S.Struct({
  screen: S.Union([
    S.Struct({ _tag: S.Literal('ListVideos') }),
    S.Struct({ _tag: S.Literal('EditVideo'), videoId: S.String }),
  ]),
  videos: S.Array(VideoSchema),
  editTitle: S.String,
  editDescription: S.String,
  editVideo: S.Option(VideoSchema),
  selectedFile: S.Any,
  isUploading: S.Boolean,
  isPublishing: S.Boolean,
  errorMessage: S.Option(S.String),
})
export type Model = {
  readonly screen: { _tag: 'ListVideos' } | { _tag: 'EditVideo'; videoId: string }
  readonly videos: readonly Video[]
  readonly editTitle: string
  readonly editDescription: string
  readonly editVideo: Option.Option<Video>
  readonly selectedFile: File | null
  readonly isUploading: boolean
  readonly isPublishing: boolean
  readonly errorMessage: Option.Option<string>
}

const LoadVideos = Command.define(
  'LoadVideos',
  SucceededLoadVideos,
  FailedLoadVideos,
)(
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() => fetch('/api/videos'))
    if (!response.ok) {
      return yield* Effect.fail(FailedLoadVideos({ error: response.statusText }))
    }
    const data = yield* Effect.promise(() => response.json() as Promise<Video[]>)
    return SucceededLoadVideos({ videos: data })
  }).pipe(
    Effect.catch((error) => Effect.succeed(FailedLoadVideos({ error: String(error) }))),
  ),
)

const CreateVideoCmd = Command.define(
  'CreateVideo',
  SucceededCreateVideo,
  FailedCreateVideo,
)(
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', description: '' }),
      }),
    )
    if (!response.ok) {
      return yield* Effect.fail(FailedCreateVideo({ error: response.statusText }))
    }
    const data = yield* Effect.promise(() => response.json() as Promise<Video>)
    return SucceededCreateVideo({ video: data })
  }).pipe(
    Effect.catch((error) => Effect.succeed(FailedCreateVideo({ error: String(error) }))),
  ),
)

const LoadVideoDetail = Command.define(
  'LoadVideoDetail',
  { id: S.String },
  SucceededLoadVideoDetail,
  FailedLoadVideoDetail,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() => fetch(`/api/videos/${input.id}`))
    if (!response.ok) {
      return yield* Effect.fail(FailedLoadVideoDetail({ error: response.statusText }))
    }
    const data = yield* Effect.promise(() => response.json() as Promise<Video>)
    return SucceededLoadVideoDetail({ video: data })
  }).pipe(
    Effect.catch((error) => Effect.succeed(FailedLoadVideoDetail({ error: String(error) }))),
  ),
)

const UploadVideoCmd = Command.define(
  'UploadVideo',
  { videoId: S.String, file: S.Any },
  SucceededUpload,
  FailedUpload,
)((input: { videoId: string; file: File }) =>
  Effect.gen(function* () {
    const formData = new FormData()
    formData.append('videoId', input.videoId)
    formData.append('file', input.file)
    const response = yield* Effect.promise<Response>(() =>
      fetch('/api/upload', {
        method: 'POST',
        body: formData,
      }),
    )
    if (!response.ok) {
      return yield* Effect.fail(FailedUpload({ error: response.statusText }))
    }
    const data = yield* Effect.promise(() => response.json() as Promise<Video>)
    return SucceededUpload({ video: data })
  }).pipe(
    Effect.catch((error) => Effect.succeed(FailedUpload({ error: String(error) }))),
  ),
)

const PublishVideoCmd = Command.define(
  'PublishVideo',
  { id: S.String },
  SucceededPublish,
  FailedPublish,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch(`/api/publish/${input.id}`, { method: 'POST' }),
    )
    if (!response.ok) {
      return yield* Effect.fail(FailedPublish({ error: response.statusText }))
    }
    const data = yield* Effect.promise(() => response.json() as Promise<Video>)
    return SucceededPublish({ video: data })
  }).pipe(
    Effect.catch((error) => Effect.succeed(FailedPublish({ error: String(error) }))),
  ),
)

const DeleteVideoCmd = Command.define(
  'DeleteVideo',
  { id: S.String },
  SucceededDeleteVideo,
  FailedDeleteVideo,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch(`/api/videos/${input.id}`, { method: 'DELETE' }),
    )
    if (!response.ok) {
      return yield* Effect.fail(FailedDeleteVideo({ error: response.statusText }))
    }
    return SucceededDeleteVideo({ id: input.id })
  }).pipe(
    Effect.catch((error) => Effect.succeed(FailedDeleteVideo({ error: String(error) }))),
  ),
)

const formatDuration = (sec: number): string => {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const formatDate = (ts: number): string => {
  return new Date(ts).toLocaleDateString()
}

const initialModel = (): Model => ({
  screen: { _tag: 'ListVideos' },
  videos: [],
  editTitle: '',
  editDescription: '',
  editVideo: Option.none(),
  selectedFile: null,
  isUploading: false,
  isPublishing: false,
  errorMessage: Option.none(),
})

export const init = () => [initialModel(), [LoadVideos()]] as const

export const update: (
  model: Model,
  message: Message,
) => readonly [Model, ReadonlyArray<any>] = (model, message) =>
  M.value(message).pipe(
    M.withReturnType<readonly [Model, ReadonlyArray<any>]>(),
    M.tagsExhaustive({
      ClickedNewVideo: () =>
        [
          evo(model, {
            screen: () => ({ _tag: 'EditVideo' as const, videoId: '' }),
            editTitle: () => '',
            editDescription: () => '',
            editVideo: () => Option.none(),
            selectedFile: () => null,
            errorMessage: () => Option.none(),
          }),
          [],
        ] as const,
      ClickedEditVideo: (msg: { id: string }) =>
        [
          evo(model, {
            screen: () => ({ _tag: 'EditVideo' as const, videoId: msg.id }),
            editTitle: () => '',
            editDescription: () => '',
            editVideo: () => Option.none(),
            errorMessage: () => Option.none(),
          }),
          [LoadVideoDetail({ id: msg.id })],
        ] as const,
      ClickedBack: () =>
        [
          evo(model, {
            screen: () => ({ _tag: 'ListVideos' as const }),
            editTitle: () => '',
            editDescription: () => '',
            editVideo: () => Option.none(),
            selectedFile: () => null,
            errorMessage: () => Option.none(),
          }),
          [],
        ] as const,
      UpdatedTitle: (msg: { title: string }) =>
        [evo(model, { editTitle: () => msg.title }), []] as const,
      UpdatedDescription: (msg: { description: string }) =>
        [evo(model, { editDescription: () => msg.description }), []] as const,
      SubmittedCreateVideo: () =>
        [
          evo(model, { errorMessage: () => Option.none() }),
          [CreateVideoCmd()],
        ] as const,
      SucceededCreateVideo: (msg: { video: Video }) =>
        [
          evo(model, {
            videos: () => [msg.video, ...model.videos] as Video[],
            screen: () => ({ _tag: 'EditVideo' as const, videoId: msg.video.id }),
            editTitle: () => msg.video.title,
            editDescription: () => msg.video.description ?? '',
            editVideo: () => Option.some(msg.video),
          }),
          [],
        ] as const,
      FailedCreateVideo: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      SucceededLoadVideos: (msg) =>
        [evo(model, { videos: () => msg.videos }), []] as const,
      FailedLoadVideos: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      SelectedFile: (msg: { file: File }) =>
        [evo(model, { selectedFile: () => msg.file }), []] as const,
      SubmittedUpload: () => {
        if (!model.selectedFile) {
          return [
            evo(model, { errorMessage: () => Option.some('Please select a file first') }),
            [],
          ] as const
        }
        if (model.screen._tag !== 'EditVideo') {
          return [model, []] as const
        }
        return [
          evo(model, { isUploading: () => true, errorMessage: () => Option.none() }),
          [UploadVideoCmd({ videoId: model.screen.videoId, file: model.selectedFile })],
        ] as const
      },
      SucceededUpload: (msg: { video: Video }) =>
        [
          evo(model, {
            isUploading: () => false,
            editVideo: () => Option.some(msg.video),
            selectedFile: () => null,
          }),
          [],
        ] as const,
      FailedUpload: (msg: { error: string }) =>
        [
          evo(model, {
            isUploading: () => false,
            errorMessage: () => Option.some(msg.error),
          }),
          [],
        ] as const,
      ClickedPublish: (msg: { id: string }) =>
        [
          evo(model, {
            isPublishing: () => true,
            errorMessage: () => Option.none(),
          }),
          [PublishVideoCmd({ id: msg.id })],
        ] as const,
      SucceededPublish: (msg: { video: Video }) =>
        [
          evo(model, {
            isPublishing: () => false,
            editVideo: () => Option.some(msg.video),
            videos: () => model.videos.map((v) => (v.id === msg.video.id ? msg.video : v)) as Video[],
          }),
          [],
        ] as const,
      FailedPublish: (msg: { error: string }) =>
        [
          evo(model, {
            isPublishing: () => false,
            errorMessage: () => Option.some(msg.error),
          }),
          [],
        ] as const,
      ClickedDeleteVideo: (msg: { id: string }) => {
        if (!window.confirm('Delete this video?')) {
          return [model, []] as const
        }
        return [
          evo(model, {
            videos: () => model.videos.filter((v) => v.id !== msg.id) as Video[],
            screen: () =>
              model.screen._tag === 'EditVideo' && model.screen.videoId === msg.id
                ? ({ _tag: 'ListVideos' } as const)
                : model.screen,
          }),
          [DeleteVideoCmd({ id: msg.id })],
        ] as const
      },
      SucceededDeleteVideo: () => [model, []] as const,
      FailedDeleteVideo: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
      SucceededLoadVideoDetail: (msg: { video: Video }) =>
        [
          evo(model, {
            editVideo: () => Option.some(msg.video),
            editTitle: () => msg.video.title,
            editDescription: () => msg.video.description ?? '',
          }),
          [],
        ] as const,
      FailedLoadVideoDetail: (msg: { error: string }) =>
        [evo(model, { errorMessage: () => Option.some(msg.error) }), []] as const,
    }),
  )

const renderRow = (h: ReturnType<typeof html<Message>>, video: Video) =>
  h.tr(
    [
      h.Class('cursor-pointer transition-colors hover:bg-gray-800/50'),
      h.OnClick(ClickedEditVideo({ id: video.id })),
    ],
    [
      h.td([h.Class('px-4 py-3 font-medium text-white')], [video.title]),
      h.td(
        [h.Class('px-4 py-3 text-gray-400 font-mono text-xs')],
        [video.slug],
      ),
      h.td([h.Class('px-4 py-3')], [
        video.publishedAt
          ? h.span(
            [h.Class('rounded-full bg-green-900/50 px-2 py-0.5 text-xs font-medium text-green-300')],
            ['Live'],
          )
          : h.span(
            [h.Class('rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs font-medium text-yellow-300')],
            ['Draft'],
          ),
      ]),
      h.td([h.Class('px-4 py-3 text-gray-400')], [
        video.durationSec > 0 ? formatDuration(video.durationSec) : '-',
      ]),
      h.td([h.Class('px-4 py-3 text-gray-400')], [formatDate(video.createdAt)]),
      h.td([h.Class('px-4 py-3')], [
        h.button(
          [
            h.Class(
              'rounded px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors',
            ),
            h.OnClick(ClickedDeleteVideo({ id: video.id })),
          ],
          ['Delete'],
        ),
      ]),
    ],
  )

const renderRows = (h: ReturnType<typeof html<Message>>, model: Model): readonly any[] => {
  if (model.videos.length === 0) {
    return [
      h.tr([], [
        h.td(
          [h.Colspan(6), h.Class('px-4 py-8 text-center text-gray-500')],
          ['No videos yet'],
        ),
      ]),
    ]
  }
  return model.videos.map((video) => renderRow(h, video))
}

const listVideosView = (h: ReturnType<typeof html<Message>>, model: Model) =>
  h.div([h.Class('mx-auto max-w-6xl')], [
    h.div([h.Class('flex items-center justify-between mb-8')], [
      h.h1([h.Class('text-2xl font-bold text-white')], ['Videos']),
      h.button(
        [
          h.Class(
            'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors',
          ),
          h.OnClick(SubmittedCreateVideo()),
        ],
        ['New Video'],
      ),
    ]),
    ...(Option.isSome(model.errorMessage)
      ? [
        h.div(
          [h.Class('mb-4 rounded-lg bg-red-900/50 border border-red-700 px-4 py-3 text-sm text-red-200')],
          [model.errorMessage.value],
        ),
      ]
      : []),
    h.div([h.Class('overflow-hidden rounded-lg border border-gray-700 bg-gray-900')], [
      h.table([h.Class('w-full text-left text-sm')], [
        h.thead([], [
          h.tr([h.Class('border-b border-gray-700 bg-gray-800/50')], [
            h.th([h.Class('px-4 py-3 font-medium text-gray-300')], ['Title']),
            h.th([h.Class('px-4 py-3 font-medium text-gray-300')], ['Slug']),
            h.th([h.Class('px-4 py-3 font-medium text-gray-300')], ['Status']),
            h.th([h.Class('px-4 py-3 font-medium text-gray-300')], ['Duration']),
            h.th([h.Class('px-4 py-3 font-medium text-gray-300')], ['Created']),
            h.th([h.Class('px-4 py-3 font-medium text-gray-300')], ['']),
          ]),
        ]),
        h.tbody([h.Class('divide-y divide-gray-800')], [
          ...renderRows(h, model),
        ]),
      ]),
    ]),
  ])

const editVideoView = (h: ReturnType<typeof html<Message>>, model: Model) => {
  const video = Option.isSome(model.editVideo) ? model.editVideo.value : null

  return h.div([h.Class('mx-auto max-w-2xl')], [
    h.button(
      [
        h.Class('mb-6 flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors'),
        h.OnClick(ClickedBack()),
      ],
      [
        h.svg(
          [
            h.Class('h-4 w-4'),
            h.ViewBox('0 0 24 24'),
            h.Fill('none'),
            h.Stroke('currentColor'),
            h.StrokeWidth('2'),
          ],
          [h.path([h.D('M15 19l-7-7 7-7')], [])],
        ),
        ' Back to videos',
      ],
    ),
    h.h1([h.Class('mb-8 text-2xl font-bold text-white')], [video ? video.title : 'New Video']),
    ...(Option.isSome(model.errorMessage)
      ? [
        h.div(
          [h.Class('mb-4 rounded-lg bg-red-900/50 border border-red-700 px-4 py-3 text-sm text-red-200')],
          [model.errorMessage.value],
        ),
      ]
      : []),
    h.div([h.Class('space-y-6')], [
      h.div([], [
        h.label([h.Class('block text-sm font-medium text-gray-300 mb-1')], ['Title']),
        h.input([
          h.Class(
            'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          ),
          h.Type('text'),
          h.Value(model.editTitle),
          h.Placeholder('Video title'),
          h.OnInput((v) => UpdatedTitle({ title: v })),
        ]),
      ]),
      h.div([], [
        h.label([h.Class('block text-sm font-medium text-gray-300 mb-1')], ['Description']),
        h.textarea(
          [
            h.Class(
              'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
            ),
            h.Placeholder('Video description'),
            h.Rows(3),
            h.OnInput((v) => UpdatedDescription({ description: v })),
          ],
          [model.editDescription],
        ),
      ]),
      ...(video?.posterKey
        ? [
          h.div([], [
            h.label([h.Class('block text-sm font-medium text-gray-300 mb-1')], ['Poster']),
            h.img([
              h.Src(`/${video.posterKey}`),
              h.Alt('Poster'),
              h.Class('w-full max-w-sm rounded-lg border border-gray-700'),
            ]),
          ]),
        ]
        : []),
      ...(!video || !video.hlsKey
        ? [
          h.div([h.Class('rounded-lg border border-dashed border-gray-600 bg-gray-900/50 p-6')], [
            h.label([h.Class('block text-sm font-medium text-gray-300 mb-3')], ['Upload MP4']),
            h.input([
              h.Type('file'),
              h.Accept('.mp4,video/mp4'),
              h.OnFileChange((files) => SelectedFile({ file: files[0] })),
            ]),
            h.button(
              [
                h.Class(
                  'mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                ),
                h.Disabled(model.isUploading),
                h.OnClick(SubmittedUpload()),
              ],
              [model.isUploading ? 'Uploading & Transcoding...' : 'Upload & Transcode'],
            ),
          ]),
        ]
        : []),
      ...(video?.hlsKey
        ? [
          h.div([h.Class('flex gap-3')], [
            h.button(
              [
                h.Class(
                  'rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                ),
                h.Disabled(model.isPublishing || !!video.publishedAt),
                h.OnClick(ClickedPublish({ id: video.id })),
              ],
              [model.isPublishing ? 'Publishing...' : 'Publish'],
            ),
          ]),
        ]
        : []),
      ...(video
        ? [
          h.div([h.Class('pt-4 border-t border-gray-800 text-xs text-gray-500 space-y-1')], [
            h.div([], ['Slug: ', h.span([h.Class('font-mono text-gray-400')], [video.slug])]),
            h.div([], ['ID: ', h.span([h.Class('font-mono text-gray-400')], [video.id])]),
            h.div([], [
              'Duration: ',
              h.span([h.Class('text-gray-400')], [formatDuration(video.durationSec)]),
            ]),
            h.div([], [
              'Created: ',
              h.span([h.Class('text-gray-400')], [formatDate(video.createdAt)]),
            ]),
            ...(video.publishedAt
              ? [
                h.div([], [
                  'Published: ',
                  h.span([h.Class('text-gray-400')], [formatDate(video.publishedAt)]),
                ]),
              ]
              : []),
          ]),
        ]
        : []),
    ]),
  ])
}

export const view = (model: Model) => {
  const h = html<Message>()
  return {
    title: 'Videoshare Admin',
    body: h.div([h.Class('min-h-screen bg-gray-950')], [
      h.div([h.Class('px-6 py-8')], [
        model.screen._tag === 'ListVideos'
          ? listVideosView(h, model)
          : editVideoView(h, model),
      ]),
    ]),
  }
}

import { Schema as S, Effect, Option } from "effect";
import { Command } from "foldkit";
import { ChapterSchema, errMsg, type Chapter, VideoSchema } from "./model";
import {
  CopiedLink,
  FailedCreateVideo,
  FailedDeleteVideo,
  FailedLoadVideoDetail,
  FailedLoadVideos,
  FailedPublish,
  FailedSaveChapters,
  FailedSaveVideo,
  FailedUnpublish,
  FailedUpload,
  SucceededCreateVideo,
  SucceededDeleteVideo,
  SucceededLoadVideoDetail,
  SucceededLoadVideos,
  SucceededPublish,
  SucceededSaveChapters,
  SucceededSaveVideo,
  SucceededUnpublish,
  SucceededUpload,
} from "./message";

const SERVER_ORIGIN = `http://${location.hostname}:3001`;

const VideoDetailResponse = S.Struct({
  video: VideoSchema,
  chapters: S.Array(ChapterSchema),
});
const ChaptersResponse = S.Struct({ chapters: S.Array(ChapterSchema) });

const decodeResponse = <A>(schema: S.Codec<A>) => {
  const decode = S.decodeUnknownOption(schema);
  return (raw: unknown): Effect.Effect<A, Error> =>
    Option.match(decode(raw), {
      onNone: () => Effect.fail(new Error("Unexpected response shape")),
      onSome: (value) => Effect.succeed(value),
    });
};

const VideoWrappedResponse = S.Struct({ video: VideoSchema });
const VideoListResponse = S.Array(VideoSchema);

const decodeVideoDetail = decodeResponse(VideoDetailResponse);
const decodeChapters = decodeResponse(ChaptersResponse);
const decodeVideo = decodeResponse(VideoSchema);
const decodeVideoWrapped = decodeResponse(VideoWrappedResponse);
const decodeVideoList = decodeResponse(VideoListResponse);

export const LoadVideos = Command.define(
  "LoadVideos",
  SucceededLoadVideos,
  FailedLoadVideos,
)(
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() => fetch("/api/videos"));
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeVideoList(raw);
    return SucceededLoadVideos({ videos: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedLoadVideos({ error: errMsg(error) })))),
);

export const CreateVideoCmd = Command.define(
  "CreateVideo",
  SucceededCreateVideo,
  FailedCreateVideo,
)(
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled", description: "" }),
      }),
    );
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeVideo(raw);
    return SucceededCreateVideo({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedCreateVideo({ error: errMsg(error) })))),
);

export const SaveVideoCmd = Command.define(
  "SaveVideo",
  { id: S.String, title: S.String, description: S.String },
  SucceededSaveVideo,
  FailedSaveVideo,
)((input: { id: string; title: string; description: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch(`/api/videos/${input.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: input.title, description: input.description }),
      }),
    );
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeVideoWrapped(raw);
    return SucceededSaveVideo({ video: data.video });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedSaveVideo({ error: errMsg(error) })))),
);

export const LoadVideoDetail = Command.define(
  "LoadVideoDetail",
  { id: S.String },
  SucceededLoadVideoDetail,
  FailedLoadVideoDetail,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() => fetch(`/api/videos/${input.id}`));
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeVideoDetail(raw);
    return SucceededLoadVideoDetail({ video: data.video, chapters: data.chapters });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedLoadVideoDetail({ error: errMsg(error) })))),
);

export const SaveChaptersCmd = Command.define(
  "SaveChapters",
  { id: S.String, chapters: S.Array(ChapterSchema) },
  SucceededSaveChapters,
  FailedSaveChapters,
)((input: { id: string; chapters: ReadonlyArray<Chapter> }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch(`/api/videos/${input.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapters: input.chapters }),
      }),
    );
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeChapters(raw);
    return SucceededSaveChapters({ chapters: data.chapters });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedSaveChapters({ error: errMsg(error) })))),
);

export const UploadVideoCmd = Command.define(
  "UploadVideo",
  { videoId: S.String, file: S.Any },
  SucceededUpload,
  FailedUpload,
)((input: { videoId: string; file: File }) =>
  Effect.gen(function* () {
    const formData = new FormData();
    formData.append("videoId", input.videoId);
    formData.append("file", input.file);
    const response = yield* Effect.promise<Response>(() =>
      fetch(`${SERVER_ORIGIN}/api/upload`, {
        method: "POST",
        body: formData,
      }),
    );
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeVideo(raw);
    return SucceededUpload({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedUpload({ error: errMsg(error) })))),
);

export const CopyLinkCmd = Command.define(
  "CopyLink",
  { url: S.String },
  CopiedLink,
)((input: { url: string }) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => navigator.clipboard.writeText(input.url));
    return CopiedLink();
  }).pipe(Effect.catch(() => Effect.succeed(CopiedLink()))),
);

export const PublishVideoCmd = Command.define(
  "PublishVideo",
  { id: S.String },
  SucceededPublish,
  FailedPublish,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch(`/api/publish/${input.id}`, { method: "POST" }),
    );
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeVideo(raw);
    return SucceededPublish({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedPublish({ error: errMsg(error) })))),
);

export const UnpublishVideoCmd = Command.define(
  "UnpublishVideo",
  { id: S.String },
  SucceededUnpublish,
  FailedUnpublish,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch(`/api/publish/${input.id}/unpublish`, { method: "POST" }),
    );
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    const raw = yield* Effect.promise<unknown>(() => response.json());
    const data = yield* decodeVideo(raw);
    return SucceededUnpublish({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedUnpublish({ error: errMsg(error) })))),
);

export const DeleteVideoCmd = Command.define(
  "DeleteVideo",
  { id: S.String },
  SucceededDeleteVideo,
  FailedDeleteVideo,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise<Response>(() =>
      fetch(`/api/videos/${input.id}`, { method: "DELETE" }),
    );
    if (!response.ok) {
      return yield* Effect.fail(new Error(response.statusText));
    }
    return SucceededDeleteVideo({ id: input.id });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedDeleteVideo({ error: errMsg(error) })))),
);

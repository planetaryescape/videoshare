import { BrowserCrypto } from "@effect/platform-browser";
import { Crypto, Effect, Option, Schema as S } from "effect";
import { Command, Dom, File as FoldkitFile } from "foldkit";
import { ChapterSchema, errMsg, type Chapter, AssetSchema } from "./model";
import {
  CopiedLink,
  FailedCopyLink,
  FailedCreateAsset,
  FailedDeleteAsset,
  FailedLoadAssetDetail,
  FailedLoadAssets,
  FailedPublish,
  FailedSaveChapters,
  FailedSaveAsset,
  FailedUnpublish,
  FailedUpload,
  FocusedChapterTitle,
  GeneratedChapterId,
  SucceededCreateAsset,
  SucceededDeleteAsset,
  SucceededLoadAssetDetail,
  SucceededLoadAssets,
  SucceededPublish,
  SucceededSaveChapters,
  SucceededSaveAsset,
  SucceededUnpublish,
  SucceededUpload,
} from "./message";

const SERVER_ORIGIN = `http://${location.hostname}:3001`;

class HttpError extends S.TaggedErrorClass<HttpError>()("HttpError", {
  status: S.Finite,
  statusText: S.String,
}) {
  override get message(): string {
    return `HTTP ${this.status} ${this.statusText}`;
  }
}

const AssetDetailResponse = S.Struct({
  video: AssetSchema,
  chapters: S.Array(ChapterSchema),
});
const ChaptersResponse = S.Struct({ chapters: S.Array(ChapterSchema) });

const decodeResponse = <A>(schema: S.Codec<A>) => {
  const decode = S.decodeUnknownOption(schema);
  return (raw: unknown): Effect.Effect<A, HttpError> =>
    Option.match(decode(raw), {
      onNone: () =>
        Effect.fail(new HttpError({ status: 0, statusText: "Unexpected response shape" })),
      onSome: (value) => Effect.succeed(value),
    });
};

const AssetWrappedResponse = S.Struct({ video: AssetSchema });
const AssetListResponse = S.Array(AssetSchema);

const decodeAssetDetail = decodeResponse(AssetDetailResponse);
const decodeChapters = decodeResponse(ChaptersResponse);
const decodeAsset = decodeResponse(AssetSchema);
const decodeAssetWrapped = decodeResponse(AssetWrappedResponse);
const decodeAssetList = decodeResponse(AssetListResponse);

const tryFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  Effect.tryPromise({
    try: (signal) => fetch(input, { ...init, signal }),
    catch: errMsg,
  });

const tryJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: errMsg,
  });

export const GenerateChapterId = Command.define(
  "GenerateChapterId",
  { assetId: S.String, startSec: S.Finite.check(S.isGreaterThanOrEqualTo(0)) },
  GeneratedChapterId,
)(({ assetId, startSec }) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const chapterId = yield* Effect.orDie(crypto.randomUUIDv4);
    return GeneratedChapterId({ chapterId, assetId, startSec });
  }).pipe(Effect.provide(BrowserCrypto.layer)),
);

export const FocusChapterTitle = Command.define(
  "FocusChapterTitle",
  { chapterId: S.String },
  FocusedChapterTitle,
)(({ chapterId }) =>
  Dom.focus(`#chapter-${chapterId}-title`).pipe(
    Effect.ignore,
    Effect.as(FocusedChapterTitle({ chapterId })),
  ),
);

export const LoadAssets = Command.define(
  "LoadAssets",
  SucceededLoadAssets,
  FailedLoadAssets,
)(
  Effect.gen(function* () {
    const response = yield* tryFetch("/api/assets");
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeAssetList(raw);
    return SucceededLoadAssets({ assets: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedLoadAssets({ error: errMsg(error) })))),
);

export const CreateAssetCmd = Command.define(
  "CreateAsset",
  SucceededCreateAsset,
  FailedCreateAsset,
)(
  Effect.gen(function* () {
    const response = yield* tryFetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled", description: "" }),
    });
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeAsset(raw);
    return SucceededCreateAsset({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedCreateAsset({ error: errMsg(error) })))),
);

export const SaveAssetCmd = Command.define(
  "SaveAsset",
  { id: S.String, title: S.String, description: S.String },
  SucceededSaveAsset,
  FailedSaveAsset,
)((input: { id: string; title: string; description: string }) =>
  Effect.gen(function* () {
    const response = yield* tryFetch(`/api/assets/${input.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: input.title, description: input.description }),
    });
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeAssetWrapped(raw);
    return SucceededSaveAsset({ video: data.video });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedSaveAsset({ error: errMsg(error) })))),
);

export const LoadAssetDetail = Command.define(
  "LoadAssetDetail",
  { id: S.String },
  SucceededLoadAssetDetail,
  FailedLoadAssetDetail,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* tryFetch(`/api/assets/${input.id}`);
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeAssetDetail(raw);
    return SucceededLoadAssetDetail({ video: data.video, chapters: data.chapters });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedLoadAssetDetail({ error: errMsg(error) })))),
);

export const SaveChaptersCmd = Command.define(
  "SaveChapters",
  { id: S.String, chapters: S.Array(ChapterSchema) },
  SucceededSaveChapters,
  FailedSaveChapters,
)((input: { id: string; chapters: ReadonlyArray<Chapter> }) =>
  Effect.gen(function* () {
    const response = yield* tryFetch(`/api/assets/${input.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapters: input.chapters }),
    });
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeChapters(raw);
    return SucceededSaveChapters({ chapters: data.chapters });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedSaveChapters({ error: errMsg(error) })))),
);

export const UploadAssetCmd = Command.define(
  "UploadAsset",
  {
    assetId: S.String,
    file: FoldkitFile.File,
    poster: S.Option(FoldkitFile.File),
  },
  SucceededUpload,
  FailedUpload,
)((input) =>
  Effect.gen(function* () {
    const formData = new FormData();
    formData.append("assetId", input.assetId);
    formData.append("file", input.file);
    if (Option.isSome(input.poster)) {
      formData.append("poster", input.poster.value);
    }
    const response = yield* tryFetch(`${SERVER_ORIGIN}/api/upload`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeAsset(raw);
    return SucceededUpload({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedUpload({ error: errMsg(error) })))),
);

export const CopyLinkCmd = Command.define(
  "CopyLink",
  { url: S.String },
  CopiedLink,
  FailedCopyLink,
)((input: { url: string }) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => navigator.clipboard.writeText(input.url),
      catch: (error) => errMsg(error),
    });
    return CopiedLink();
  }).pipe(Effect.catch((error) => Effect.succeed(FailedCopyLink({ error })))),
);

export const PublishAssetCmd = Command.define(
  "PublishAsset",
  { id: S.String },
  SucceededPublish,
  FailedPublish,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* tryFetch(`/api/publish/${input.id}`, { method: "POST" });
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeAsset(raw);
    return SucceededPublish({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedPublish({ error: errMsg(error) })))),
);

export const UnpublishAssetCmd = Command.define(
  "UnpublishAsset",
  { id: S.String },
  SucceededUnpublish,
  FailedUnpublish,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* tryFetch(`/api/publish/${input.id}/unpublish`, { method: "POST" });
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    const raw = yield* tryJson(response);
    const data = yield* decodeAsset(raw);
    return SucceededUnpublish({ video: data });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedUnpublish({ error: errMsg(error) })))),
);

export const DeleteAssetCmd = Command.define(
  "DeleteAsset",
  { id: S.String },
  SucceededDeleteAsset,
  FailedDeleteAsset,
)((input: { id: string }) =>
  Effect.gen(function* () {
    const response = yield* tryFetch(`/api/assets/${input.id}`, { method: "DELETE" });
    if (!response.ok) {
      return yield* new HttpError({ status: response.status, statusText: response.statusText });
    }
    return SucceededDeleteAsset({ id: input.id });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedDeleteAsset({ error: errMsg(error) })))),
);

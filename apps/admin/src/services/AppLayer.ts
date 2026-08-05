import { Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { BunFileSystem } from "@effect/platform-bun";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { MediaProcessor } from "./MediaProcessor.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { Storage } from "./Storage.ts";
import { PublicationGate } from "./PublicationGate.ts";
import { MediaReplacement } from "./MediaReplacement.ts";
import { ProdSync, Publisher } from "../prod.ts";

const dbFilename = process.env["VIDEOSHARE_DB"] ?? `${import.meta.dir}/videoshare-admin.db`;
const sqlLayer = SqliteClient.layer({ filename: dbFilename });
const platformLayer = Layer.merge(HttpServer.layerServices, BunFileSystem.layer);
const storageLive = Storage.layer.pipe(Layer.provide(platformLayer));
const mediaProcessorLive = Layer.provideMerge(
  MediaProcessor.layer,
  Layer.mergeAll(ProgressBus.layer, storageLive),
);
const repositories = Layer.mergeAll(
  AssetRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
  ProjectRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
);
const publisherLive = Publisher.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(ProdSync.layer, repositories, storageLive)),
);
const mediaReplacementLive = MediaReplacement.layer.pipe(
  Layer.provideMerge(Layer.merge(ProdSync.layer, repositories)),
);

export const AppLayer = Layer.mergeAll(
  mediaProcessorLive,
  ProdSync.layer,
  repositories,
  publisherLive,
  mediaReplacementLive,
  PublicationGate.layer,
).pipe(Layer.provideMerge(platformLayer), Layer.provide(sqlLayer));

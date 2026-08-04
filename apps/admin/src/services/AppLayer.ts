import { Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { BunFileSystem } from "@effect/platform-bun";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { AssetRepository } from "@videoshare/shared/AssetRepository";
import { ProjectRepository } from "@videoshare/shared/ProjectRepository";
import { MediaProcessor } from "./MediaProcessor.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { Storage } from "./Storage.ts";
import { ProdSync } from "../prod.ts";

const dbFilename = process.env["VIDEOSHARE_DB"] ?? `${import.meta.dir}/videoshare-admin.db`;

const sqlLayer = SqliteClient.layer({ filename: dbFilename });
const platformLayer = Layer.merge(HttpServer.layerServices, BunFileSystem.layer);
const storageLive = Storage.layer.pipe(Layer.provide(platformLayer));
const mediaProcessorLive = Layer.provideMerge(
  MediaProcessor.layer,
  Layer.mergeAll(ProgressBus.layer, storageLive),
);

export const AppLayer = Layer.mergeAll(
  mediaProcessorLive,
  ProdSync.layer,
  AssetRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
  ProjectRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
).pipe(Layer.provideMerge(platformLayer), Layer.provide(sqlLayer));

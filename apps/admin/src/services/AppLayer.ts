import { Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { BunFileSystem } from "@effect/platform-bun";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { Transcoder } from "./Transcoder.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { Storage } from "./Storage.ts";
import { ProdSync } from "../prod.ts";

const dbFilename = process.env["VIDEOSHARE_DB"] ?? `${import.meta.dir}/videoshare-admin.db`;

const sqlLayer = SqliteClient.layer({ filename: dbFilename });

const platformLayer = Layer.merge(HttpServer.layerServices, BunFileSystem.layer);

export const AppLayer = Layer.mergeAll(
  Transcoder.layer.pipe(Layer.provide(Storage.layer), Layer.provide(ProgressBus.layer)),
  ProgressBus.layer,
  Storage.layer.pipe(Layer.provide(platformLayer)),
  ProdSync.layer,
  VideoRepository.layerNoDeps.pipe(Layer.provide(sqlLayer)),
).pipe(Layer.provideMerge(platformLayer), Layer.provide(sqlLayer));

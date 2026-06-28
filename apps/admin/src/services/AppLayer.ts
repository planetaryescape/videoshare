import { Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { VideoRepository } from "@videoshare/shared/VideoRepository";
import { Transcoder } from "./Transcoder.ts";
import { ProgressBus } from "./ProgressBus.ts";
import { Storage } from "./Storage.ts";
import { ProdSync } from "../prod.ts";

const sqlLayer = SqliteClient.layer({ filename: "./videoshare-admin.db" });

export const AppLayer = Layer.mergeAll(
  Transcoder.layer,
  ProgressBus.layer,
  Storage.layer,
  ProdSync.layer,
  VideoRepository.layerNoDeps,
  BunFileSystem.layer,
).pipe(Layer.provide(sqlLayer));

import { Asset, AssetId, Kind, ProjectId, Slug } from "./Asset.ts";
import { Schema } from "effect";

/** Raw asset columns selected by SQLite persistence adapters. */
export interface AssetRow {
  readonly id: string;
  readonly slug: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string | null;
  readonly poster_key: string | null;
  readonly media_key: string;
  readonly duration_sec: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly password_hash: string | null;
  readonly project_id: string | null;
  readonly sort_order: number | null;
  readonly created_at: number;
  readonly published_at: number | null;
  readonly updated_at: number | null;
}

/** Reconstructs an Asset from a persistence row; callers own boundary error translation. */
export const assetFromRow = (row: AssetRow): Asset =>
  new Asset({
    id: AssetId.make(row.id),
    slug: Slug.make(row.slug),
    kind: Schema.decodeUnknownSync(Kind)(row.kind),
    title: row.title,
    description: row.description,
    posterKey: row.poster_key,
    mediaKey: row.media_key,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    passwordHash: row.password_hash,
    projectId: row.project_id === null ? null : ProjectId.make(row.project_id),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  });

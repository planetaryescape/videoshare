import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Asset, AssetId, Slug } from "@videoshare/shared/Asset";
import worker, { renderOpenGraphTags } from "./worker.ts";

type ViewerEnv = Parameters<(typeof worker)["fetch"]>[1];
type D1Database = ViewerEnv["DB"];
type D1Statement = ReturnType<D1Database["prepare"]>;

const d1Meta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
};

/** Adapts Bun SQLite to the subset of D1 exercised by the Worker dispatch seam. */
const d1Database = (database: Database): D1Database => {
  const prepare = (query: string): D1Statement => {
    let values: ReadonlyArray<unknown> = [];
    const statement: D1Statement = {
      bind(...nextValues) {
        values = nextValues;
        return statement;
      },
      async first(columnName?: string) {
        const row = database
          .query<Record<string, unknown>, ReadonlyArray<unknown>>(query)
          .get(...values);
        if (!row) return null;
        return columnName === undefined ? row : (row[columnName] ?? null);
      },
      async run() {
        const result = database.query(query).run(...values);
        return { success: true, meta: { ...d1Meta, changes: result.changes } };
      },
      async all() {
        return {
          success: true,
          meta: d1Meta,
          results: database
            .query<Record<string, unknown>, ReadonlyArray<unknown>>(query)
            .all(...values),
        };
      },
      async raw(options?) {
        const rows = database
          .query<ReadonlyArray<unknown>, ReadonlyArray<unknown>>(query)
          .values(...values);
        if (options?.columnNames) return [[], ...rows];
        return rows;
      },
    };
    return statement;
  };

  return {
    prepare,
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.all()));
    },
    async exec(query) {
      database.exec(query);
      return { count: 0, duration: 0 };
    },
    withSession() {
      return {
        prepare,
        batch: async (statements) => Promise.all(statements.map((statement) => statement.all())),
        getBookmark: () => null,
      };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };
};

const viewerEnv = (database: Database): ViewerEnv => ({
  DB: d1Database(database),
  BUCKET: {
    async get(key) {
      return {
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        httpEtag: `etag-${key}`,
        size: 0,
        httpMetadata: { contentType: "video/webm" },
        writeHttpMetadata() {},
      };
    },
  },
});

const setupCatalog = (database: Database) => {
  database.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, poster_key TEXT, media_key TEXT NOT NULL, duration_sec REAL NOT NULL,
      width INTEGER, height INTEGER, password_hash TEXT, project_id TEXT, sort_order INTEGER,
      created_at INTEGER NOT NULL, published_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE chapters (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, title TEXT NOT NULL, start_sec REAL NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT, password_hash TEXT, created_at INTEGER NOT NULL, published_at INTEGER, updated_at INTEGER);
    INSERT INTO assets VALUES ('legacy-p', 'p', 'video', 'Legacy', NULL, NULL, 'media/legacy-p/master.m3u8', 1, NULL, NULL, NULL, NULL, NULL, 1, 2, 2);
    INSERT INTO projects VALUES ('project-1', 'project-route', 'Project route', NULL, NULL, 1, 2, 2);
    INSERT INTO assets VALUES ('member-1', 'member', 'video', 'Member', NULL, NULL, 'media/member/master.m3u8', 1, NULL, NULL, NULL, 'project-1', 0, 1, 2, 2);
  `);
};

const imageAsset = new Asset({
  id: AssetId.make("image-1"),
  slug: Slug.make("image_1"),
  kind: "image",
  title: "Image",
  description: null,
  posterKey: null,
  mediaKey: "media/image-1/original.webp",
  durationSec: 0,
  width: 640,
  height: 480,
  passwordHash: null,
  projectId: null,
  sortOrder: null,
  createdAt: 1,
  publishedAt: 2,
  updatedAt: 3,
});

describe("legacy direct `p` compatibility", () => {
  test("dispatches absent-project HEAD requests to legacy media while existing projects retain their method guard", async () => {
    using database = new Database(":memory:");
    setupCatalog(database);
    const env = viewerEnv(database);

    const projectHead = await worker.fetch(
      new Request("https://viewer.example/p/project-route", { method: "HEAD" }),
      env,
    );
    expect(projectHead.status).toBe(405);

    const legacyHead = await worker.fetch(
      new Request("https://viewer.example/p/legacy.webm", { method: "HEAD" }),
      env,
    );
    expect(legacyHead.status).toBe(200);
    expect(legacyHead.headers.get("etag")).toBe("etag-media/legacy-p/legacy.webm");
    expect(legacyHead.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await legacyHead.text()).toBe("");
  });
});

describe("renderOpenGraphTags", () => {
  test("uses an image asset's direct media URL when it has no poster", () => {
    const tags = renderOpenGraphTags("https://viewer.example", "image_1", imageAsset);

    expect(tags).toContain(
      '<meta property="og:image" content="https://viewer.example/image_1/original.webp">',
    );
    expect(tags).toContain(
      '<meta name="twitter:image" content="https://viewer.example/image_1/original.webp">',
    );
  });
});

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "VideoShare",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2Bucket("VideoBucket");
    const db = yield* Cloudflare.D1Database("VideoDatabase", {
      migrationsDir: "./packages/shared/migrations",
      importFiles: ["./packages/shared/seed/0001_demo_video.sql"],
    });
    const viewer = yield* Cloudflare.Worker("ViewerWorker", {
      main: "./apps/viewer/src/worker.ts",
      env: {
        DB: db,
        BUCKET: bucket,
      },
    });

    return {
      bucketName: bucket.bucketName,
      databaseName: db.databaseName,
      viewerDomains: viewer.domains,
    };
  }),
);

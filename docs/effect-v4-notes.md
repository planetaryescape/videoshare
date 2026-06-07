# Effect v4 (beta) API notes

We are on `effect@4.0.0-beta.78` (forced by `alchemy@2` beta). This is a major version: the API differs substantially from Effect 3.x. **`repos/accountability` is 3.x — do not copy its imports/API verbatim.** The authoritative source is `repos/effectv4` (the Effect monorepo source + `ai-docs/` + `LLMS.md`). Everything below was verified against that source, not guessed.

## Imports are barrel-style

```ts
import { Effect, Schema, Layer, Context, Option, Array } from "effect"
```

Unstable/platform modules live under `effect/unstable/*`:

```ts
import { SqlClient, SqlSchema, SqlError } from "effect/unstable/sql"
import { HttpApiSchema } from "effect/unstable/httpapi"
```

There is **no separate `@effect/sql` or `@effect/platform` package** in v4. SQL and HTTP API moved into core under `effect/unstable`.

## Schema

- Models: `class X extends Schema.Class<X>("X")({ ...fields }) {}`.
- Brands: `Schema.String.pipe(Schema.brand("VideoId"))`. Construct with `.make(value)` (throws on invalid) or `.makeOption(value)`.
- Primitives: `Schema.String`, `Schema.Number`, `Schema.Int`, `Schema.Finite`. There is **no `Schema.UUID`** and **no `Schema.NonEmptyTrimmedString`**; there is `Schema.NonEmptyString`, `Schema.Trimmed`.
- Constraints use the **`.check(...)`** method with predicate filters, NOT `.pipe(Schema.int())`:
  ```ts
  Schema.String.check(Schema.isNonEmpty(), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
  Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 150 }))
  ```
  Filter predicates: `isNonEmpty`, `isInt`, `isPattern(regex)`, `isUUID(version?)`, `isGreaterThan(OrEqualTo)`, `isLessThan(OrEqualTo)`, `isBetween`, `isMultipleOf`, etc.
- Nullable field: `Schema.NullOr(Schema.String)`. (`Schema.OptionFromNullOr` exists too, if you want `Option` in the model.)
- `Schema.Defect()` is a **function** — call it: `cause: Schema.Defect()`.

## Errors

- `class E extends Schema.TaggedErrorClass<E>()("E", { ...fields }) {}` (note: `TaggedErrorClass`, not `TaggedError`).
- Third arg is `Annotations.Declaration` (general schema annotations), **not** an HTTP status object.
- A custom `message` getter must be marked `override` (the base `YieldableError` already has `message`).
- Yield an error inside `Effect.gen` with `return yield* new E({...})`.
- Catch with `Effect.catchTag("E", ...)`, `Effect.catchTags({...})`, `Effect.catch(...)`.

## Services (Context.Service)

```ts
export class VideoRepository extends Context.Service<VideoRepository, {
  findBySlug(slug: string): Effect.Effect<Option.Option<Video>, PersistenceError>
}>()("videoshare/VideoRepository") {
  static readonly layerNoDeps = Layer.effect(
    VideoRepository,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const findBySlug = Effect.fn("VideoRepository.findBySlug")(function*(slug: string) {
        const rows = yield* sql<Row>`SELECT * FROM videos WHERE slug = ${slug}`
        return Array.head(rows).pipe(Option.map(toVideo))
      }, Effect.mapError((cause) => new PersistenceError({ operation: "findBySlug", cause })))
      return VideoRepository.of({ findBySlug })
    })
  )
}
```

- Define methods with `Effect.fn("name")(function*(...) { ... }, ...combinators)`.
- Build the instance with `Self.of({ ...methods })`.
- Access the service type via `Self["Service"]` if needed.
- `layerNoDeps` depends on `SqlClient` (the abstract tag). Compose the concrete dialect with `Layer.provide` / `Layer.provideMerge`.

## SQL

- The tag is `SqlClient.SqlClient` from `effect/unstable/sql`. Get it: `const sql = yield* SqlClient.SqlClient`.
- Run queries with the tagged template: `` sql<RowType>`SELECT * FROM videos WHERE slug = ${slug}` `` (returns `ReadonlyArray<RowType>`). Interpolations are parameterized.
- `SqlError.SqlError` is the error type; map it to a domain error with `Effect.mapError`.
- `SqlSchema` query builders: `findAll`, `findNonEmpty`, `findOne` (fails `NoSuchElementError` if empty), `findOneOption` (returns `Option`). Shape:
  ```ts
  SqlSchema.findOne({ Request, Result, execute: (encoded) => Effect.Effect<readonly unknown[]> })
  ```
  (We mostly use raw `sql\`\`` + manual mapping for clarity in the lean approach.)

### Dialect client layers

- SQLite (admin, local): `import { SqliteClient } from "@effect/sql-sqlite-bun"` → `SqliteClient.layer({ filename, transformResultNames?, transformQueryNames? })`. Also `SqliteMigrator`.
- D1 (viewer, edge): `import { D1Client } from "@effect/sql-d1"` → `D1Client.layer({ db: D1Database, transformResultNames?, transformQueryNames? })`.
- Both layers provide the common `SqlClient` tag, which is why one repository runs on both. `transformResultNames` / `transformQueryNames` can auto-map snake_case ↔ camelCase.

## HttpApi (only if we ever go beyond lean routes)

- `HttpApiSchema.status(code)` is a **pipeable transform applied at the endpoint definition**, e.g. `error: UserNotFound.pipe(HttpApiSchema.status(404))`. It is NOT an annotation on the error class.
- Read status back from an AST with `HttpApiSchema.getStatusError(ast)` / `getStatusSuccess(ast)`.
- Endpoints: `HttpApiEndpoint.get("name", "/path", { params, payload, success, error })`; groups via `HttpApiGroup.make("name").add(...)`.
- We are **not** using this framework (lean decision). We keep a tag→status map in `VideoErrors.ts` and apply it at the route edge instead.

## Verified runnable

The shared package was run on a real in-memory SQLite DB (`SqliteClient.layer({ filename: ":memory:" })`): migrate → create → findBySlug (hit and miss) → list all succeeded. The patterns above are confirmed working, not just type-checking.

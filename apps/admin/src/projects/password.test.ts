import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { projectPasswordHash } from "./password.ts";

describe("project password boundary", () => {
  test("uses a salted PBKDF2 verifier", async () => {
    await expect(Effect.runPromise(projectPasswordHash("hello"))).resolves.toMatch(
      /^pbkdf2-sha256\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$/,
    );
  });

  test("distinguishes preserve and clear without retaining plaintext", async () => {
    await expect(Effect.runPromise(projectPasswordHash(undefined))).resolves.toBeUndefined();
    await expect(Effect.runPromise(projectPasswordHash(""))).resolves.toBeNull();
  });
});

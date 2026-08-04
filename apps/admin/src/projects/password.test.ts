import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { projectPasswordHash } from "./password.ts";

describe("project password boundary", () => {
  test("uses the portable Worker SHA-256 hex representation", async () => {
    await expect(Effect.runPromise(projectPasswordHash("hello"))).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  test("distinguishes preserve and clear without retaining plaintext", async () => {
    await expect(Effect.runPromise(projectPasswordHash(undefined))).resolves.toBeUndefined();
    await expect(Effect.runPromise(projectPasswordHash(""))).resolves.toBeNull();
  });
});

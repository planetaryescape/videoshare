import { Effect } from "effect";
import { PersistenceError } from "@videoshare/shared/AssetErrors";

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Portable hash used by Worker asset gates. Undefined preserves an existing password; empty clears it. */
export const projectPasswordHash = (password: string | undefined) => {
  if (password === undefined)
    return Effect.succeed({ value: undefined }).pipe(Effect.map(({ value }) => value));
  if (password === "") return Effect.succeed<string | null | undefined>(null);
  return Effect.tryPromise({
    try: async () => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password))),
    catch: (cause) => new PersistenceError({ operation: "hashProjectPassword", cause }),
  });
};

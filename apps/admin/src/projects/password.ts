import { Effect } from "effect";
import { PersistenceError } from "@videoshare/shared/AssetErrors";
import { hashProjectPassword } from "@videoshare/shared/ProjectPassword";

/** Portable hash used by Worker asset gates. Undefined preserves an existing password; empty clears it. */
export const projectPasswordHash = (password: string | undefined) => {
  if (password === undefined) return Effect.succeed<string | null | undefined>(undefined);
  if (password === "") return Effect.succeed<string | null | undefined>(null);
  return Effect.tryPromise({
    try: () => hashProjectPassword(password),
    catch: (cause) => new PersistenceError({ operation: "hashProjectPassword", cause }),
  });
};

import { Slug } from "./Video.ts";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

export const generateSlug = (length = 16): Slug => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const out = Array.from(bytes, (b) => ALPHABET.charAt(b % ALPHABET.length)).join("");
  return Slug.make(out);
};

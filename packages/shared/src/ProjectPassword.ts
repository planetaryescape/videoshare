import { sha256Hex } from "./Sha256.ts";

const iterations = 210_000;
const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const fromHex = (value: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[0-9a-f]{32}$/i.test(value)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = value.slice(index * 2, index * 2 + 2);
    bytes[index] = Number.parseInt(pair, 16);
  }
  return bytes;
};

const derive = async (password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> => {
  const encodedPassword = encoder.encode(password);
  const passwordBytes = new Uint8Array(new ArrayBuffer(encodedPassword.byteLength));
  passwordBytes.set(encodedPassword);
  const key = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations, salt },
    key,
    256,
  );
  return sha256Hex(bits);
};

/** Derives a salted, work-factor password verifier suitable for project persistence. */
export const hashProjectPassword = async (password: string): Promise<string> => {
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  return `pbkdf2-sha256$${iterations}$${toHex(salt)}$${await derive(password, salt)}`;
};

/** Verifies a plaintext project password against its persisted PBKDF2 verifier. */
export const verifyProjectPassword = async (
  password: string,
  verifier: string,
): Promise<boolean> => {
  const [algorithm, workFactor, encodedSalt, expected, ...rest] = verifier.split("$");
  if (
    algorithm !== "pbkdf2-sha256" ||
    workFactor !== String(iterations) ||
    encodedSalt === undefined ||
    expected === undefined ||
    rest.length > 0
  )
    return false;
  const salt = fromHex(encodedSalt);
  if (salt === null || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  const actual = await derive(password, salt);
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1)
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
};

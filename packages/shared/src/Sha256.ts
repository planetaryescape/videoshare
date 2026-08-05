/** Encodes a SHA-256 digest as lowercase hexadecimal for portable password verification. */
export const sha256Hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Returns the HTTP content type for media stored locally or in R2. */
export const mediaContentType = (key: string): string => {
  if (key.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (key.endsWith(".ts")) return "video/mp2t";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".vtt")) return "text/vtt";
  if (key.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
};

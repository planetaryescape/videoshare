/** Returns the R2 directory containing a media object, preserving legacy key layouts. */
export const r2KeyDir = (key: string): string => {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? "" : key.slice(0, slash + 1);
};

/** DOM id shared by the review player, playback-time capture, and HLS connector. */
export const CHAPTER_PLAYER_ID = "chapter-player";

/** DOM id for playback failures reported by the HLS connector. */
export const CHAPTER_PLAYER_ERROR_ID = "chapter-player-error";

/** Returns the current review playback position rounded down to a whole second. */
export const currentChapterStartSec = (): number => {
  const player = document.getElementById(CHAPTER_PLAYER_ID);
  if (!player || !("currentTime" in player)) {
    return 0;
  }

  const currentTime: unknown = player.currentTime;
  return typeof currentTime === "number" && Number.isFinite(currentTime) && currentTime >= 0
    ? Math.floor(currentTime)
    : 0;
};

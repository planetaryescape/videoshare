import Hls, { ErrorTypes, Events } from "hls.js";
import { CHAPTER_PLAYER_ID } from "./chapterPlayback";

/** Connects the admin review media element to HLS playback for the application lifetime. */
export const mountChapterPlayer = () => {
  let activePlayer: HTMLMediaElement | null = null;
  let activeSource = "";
  let activeHls: Hls | null = null;

  const connect = () => {
    const nextPlayer = document.querySelector<HTMLMediaElement>(`#${CHAPTER_PLAYER_ID}`);
    const nextSource = nextPlayer?.getAttribute("src") ?? "";
    if (nextPlayer === activePlayer && nextSource === activeSource) {
      return;
    }

    activeHls?.destroy();
    activeHls = null;
    activePlayer = nextPlayer;
    activeSource = nextSource;

    if (!nextPlayer || !nextSource || nextPlayer.canPlayType("application/vnd.apple.mpegurl")) {
      return;
    }
    // oxlint-disable-next-line import/no-named-as-default-member -- hls.js exposes isSupported only on its default class in TypeScript.
    if (!Hls.isSupported()) {
      return;
    }

    const hls = new Hls();
    hls.on(Events.ERROR, (_, data) => {
      if (!data.fatal) {
        return;
      }
      if (data.type === ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }
      if (data.type === ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      hls.destroy();
      if (activeHls === hls) {
        activeHls = null;
      }
    });
    activeHls = hls;
    hls.loadSource(nextSource);
    hls.attachMedia(nextPlayer);
  };

  const observer = new MutationObserver(connect);
  observer.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(connect);

  window.addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      activeHls?.destroy();
    },
    { once: true },
  );
};

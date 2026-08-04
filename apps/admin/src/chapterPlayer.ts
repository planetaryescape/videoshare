import Hls, { ErrorTypes, Events } from "hls.js";
import { CHAPTER_PLAYER_ERROR_ID, CHAPTER_PLAYER_ID } from "./chapterPlayback";

/** Connects the admin review media element to HLS playback for the application lifetime. */
export const mountChapterPlayer = () => {
  let activePlayer: HTMLMediaElement | null = null;
  let activeSource = "";
  let activeHls: Hls | null = null;
  let retryTimeout: number | undefined;

  const showPlaybackError = (message: string) => {
    const error = document.getElementById(CHAPTER_PLAYER_ERROR_ID);
    if (error) {
      error.textContent = message;
    }
  };

  const destroyActiveHls = () => {
    if (retryTimeout !== undefined) {
      window.clearTimeout(retryTimeout);
      retryTimeout = undefined;
    }
    activeHls?.destroy();
    activeHls = null;
  };

  const connect = () => {
    const nextPlayer = document.querySelector<HTMLMediaElement>(`#${CHAPTER_PLAYER_ID}`);
    const nextSource = nextPlayer?.dataset.hlsSource ?? "";
    if (nextPlayer === activePlayer && nextSource === activeSource) {
      return;
    }

    destroyActiveHls();
    activePlayer = nextPlayer;
    activeSource = nextSource;
    showPlaybackError("");

    if (!nextPlayer || !nextSource || nextPlayer.canPlayType("application/vnd.apple.mpegurl")) {
      return;
    }
    // oxlint-disable-next-line import/no-named-as-default-member -- hls.js exposes isSupported only on its default class in TypeScript.
    if (!Hls.isSupported()) {
      return;
    }

    const hls = new Hls();
    let networkRetries = 0;
    let mediaRetries = 0;
    hls.on(Events.MANIFEST_PARSED, () => {
      networkRetries = 0;
      showPlaybackError("");
    });
    hls.on(Events.FRAG_BUFFERED, () => {
      mediaRetries = 0;
    });
    hls.on(Events.ERROR, (_, data) => {
      if (!data.fatal) {
        return;
      }
      if (data.type === ErrorTypes.NETWORK_ERROR) {
        if (retryTimeout !== undefined) {
          return;
        }
        if (networkRetries < 3) {
          const delayMs = 1_000 * 2 ** networkRetries;
          networkRetries += 1;
          retryTimeout = window.setTimeout(() => {
            retryTimeout = undefined;
            if (activeHls === hls) {
              hls.startLoad();
            }
          }, delayMs);
          return;
        }
      }
      if (data.type === ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
        mediaRetries += 1;
        hls.recoverMediaError();
        return;
      }
      showPlaybackError(
        data.type === ErrorTypes.NETWORK_ERROR
          ? "Playback stopped after repeated network errors. Check your connection and reload the page."
          : "Playback stopped because the media could not be loaded. Reload the page to try again.",
      );
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
      destroyActiveHls();
    },
    { once: true },
  );
};

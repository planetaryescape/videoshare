import "../node_modules/vidstack/dist/prod/define/media-player.js";
import "../node_modules/vidstack/dist/prod/define/media-community-skin.js";

interface SeekableMediaPlayerElement extends HTMLElement {
  currentTime: number;
}

const player = document.querySelector<SeekableMediaPlayerElement>("media-player");
const chapterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-chapter-start]"),
);

const chapterStartFor = (button: HTMLButtonElement) => {
  const chapterStart = Number(button.dataset.chapterStart);
  return Number.isFinite(chapterStart) && chapterStart >= 0 ? chapterStart : null;
};

const updateActiveChapter = (currentTime: number) => {
  let activeButton: HTMLButtonElement | null = null;
  let activeStart = -1;

  for (const button of chapterButtons) {
    const chapterStart = chapterStartFor(button);
    if (chapterStart !== null && chapterStart <= currentTime && chapterStart >= activeStart) {
      activeButton = button;
      activeStart = chapterStart;
    }
  }

  for (const button of chapterButtons) {
    const isActive = button === activeButton;
    button.toggleAttribute("data-active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  }
};

const seekToChapter = (event: MouseEvent) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const chapterButton = event.target.closest<HTMLButtonElement>("[data-chapter-start]");
  if (!chapterButton) {
    return;
  }

  const chapterStart = chapterStartFor(chapterButton);
  if (chapterStart === null || !player) {
    return;
  }

  player.currentTime = chapterStart;
  updateActiveChapter(chapterStart);
};

document.addEventListener("click", seekToChapter);

if (player) {
  player.addEventListener("time-update", () => updateActiveChapter(player.currentTime));
  updateActiveChapter(player.currentTime);
}

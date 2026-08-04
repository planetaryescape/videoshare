const LIST_SELECTOR = ".chapter-list";
const ROW_SELECTOR = ".chapter-row";
const DURATION_MS = 220;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const rowKey = (row: HTMLElement): string => row.querySelector("input")?.id ?? "";

/** Row offsets measured against the list itself, so page scrolling cannot skew the deltas. */
const measure = (list: HTMLElement): Map<string, number> => {
  const listTop = list.getBoundingClientRect().top;
  const positions = new Map<string, number>();
  for (const row of list.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    const key = rowKey(row);
    if (key !== "") {
      positions.set(key, row.getBoundingClientRect().top - listTop);
    }
  }
  return positions;
};

/**
 * FLIP animation for the chapter list. Rows are keyed by the vdom, so editing a
 * timestamp moves an existing element rather than replacing it. Each patch is
 * compared against the previous layout and the difference is played back as a
 * transform, which keeps a re-sort readable instead of an instant jump.
 */
export const mountChapterReorder = () => {
  let previous = new Map<string, number>();

  const sync = () => {
    const list = document.querySelector<HTMLElement>(LIST_SELECTOR);
    if (!list) {
      previous = new Map();
      return;
    }

    const current = measure(list);
    if (prefersReducedMotion()) {
      previous = current;
      return;
    }

    for (const row of list.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
      const key = rowKey(row);
      const before = previous.get(key);
      const after = current.get(key);
      if (before === undefined || after === undefined) {
        continue;
      }
      const delta = before - after;
      if (Math.abs(delta) < 1) {
        continue;
      }
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], {
        duration: DURATION_MS,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
    }

    previous = current;
  };

  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(sync);

  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
};

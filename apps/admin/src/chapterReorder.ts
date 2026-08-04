const LIST_SELECTOR = ".chapter-list";
const ROW_SELECTOR = ".chapter-row";
const DURATION_MS = 220;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const rowKey = (row: HTMLElement): string => row.querySelector("input")?.id ?? "";

/** offsetTop is unaffected by an in-flight FLIP transform. */
const measure = (list: HTMLElement): Map<string, number> => {
  const positions = new Map<string, number>();
  for (const row of list.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    const key = rowKey(row);
    if (key !== "") {
      positions.set(key, row.offsetTop);
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
  let list: HTMLElement | null = null;
  let listObserver: MutationObserver | null = null;
  let previous = new Map<string, number>();

  const sync = () => {
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

  const connectList = () => {
    const nextList = document.querySelector<HTMLElement>(LIST_SELECTOR);
    if (nextList === list) {
      return;
    }
    listObserver?.disconnect();
    list = nextList;
    previous = new Map();
    if (list) {
      listObserver = new MutationObserver(sync);
      listObserver.observe(list, { childList: true, subtree: true });
      sync();
    }
  };

  const rootObserver = new MutationObserver(connectList);
  rootObserver.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(connectList);

  window.addEventListener("pagehide", (event) => {
    if (event.persisted) {
      return;
    }
    rootObserver.disconnect();
    listObserver?.disconnect();
  });
  window.addEventListener("pageshow", connectList);
};

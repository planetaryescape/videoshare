import "../node_modules/vidstack/dist/prod/define/media-player.js";
import "../node_modules/vidstack/dist/prod/define/media-community-skin.js";
import {
  isTimedKind,
  statesEqual,
  transition,
  type ProjectPlayerEvent,
  type ProjectPlayerState,
  stateForProjectPath,
  stateForRoute,
  viewing,
} from "./project-player.ts";

const root = document.querySelector<HTMLElement>("[data-project-player]");
if (!root) throw new Error("Project player root is missing");

const memberSlugs = root.dataset.memberSlugs?.split(",").filter(Boolean) ?? [];
const memberKinds = root.dataset.memberKinds?.split(",").filter(Boolean) ?? [];
const projectSlug = root.dataset.projectSlug;
if (!projectSlug) throw new Error("Project slug is missing");

let state: ProjectPlayerState = stateForRoute(root.dataset.selected ?? null, memberSlugs) ?? {
  _tag: "Viewing",
  index: 0,
};
const stage = root.querySelector<HTMLElement>("[data-project-stage]");
const status = root.querySelector<HTMLElement>("[data-project-status]");
const title = root.querySelector<HTMLElement>("[data-project-title]");
const description = root.querySelector<HTMLElement>("[data-project-description]");
const position = root.querySelector<HTMLElement>("[data-project-position]");
const controls = root.querySelector<HTMLElement>("[data-project-controls]");
const previousControl = controls?.querySelector<HTMLAnchorElement>(
  '[data-project-action="previous"]',
);
const nextControl = controls?.querySelector<HTMLAnchorElement>(
  '[data-project-action="next"], [data-project-action="restart"]',
);
if (
  !stage ||
  !status ||
  !title ||
  !description ||
  !position ||
  !controls ||
  !previousControl ||
  !nextControl
)
  throw new Error("Project player markup is incomplete");

const urlFor = (next: ProjectPlayerState) =>
  next._tag === "Summary"
    ? `/p/${encodeURIComponent(projectSlug)}/summary`
    : `/p/${encodeURIComponent(projectSlug)}/${encodeURIComponent(memberSlugs[next.index] ?? "")}`;

const setControl = (
  control: HTMLAnchorElement,
  action: "previous" | "next" | "restart",
  label: string,
  destination: ProjectPlayerState,
  disabled: boolean,
) => {
  control.dataset.projectAction = action;
  control.href = urlFor(destination);
  control.textContent = label;
  control.setAttribute("aria-disabled", String(disabled));
  if (disabled) control.setAttribute("tabindex", "-1");
  else control.removeAttribute("tabindex");
  control.classList.toggle("is-disabled", disabled);
};

const summaryState: ProjectPlayerState = { _tag: "Summary" };

const renderControls = (next: ProjectPlayerState) => {
  if (next._tag === "Summary") {
    const last = memberSlugs.length === 0 ? summaryState : viewing(memberSlugs.length - 1);
    setControl(previousControl, "previous", "Previous", last, memberSlugs.length === 0);
    setControl(
      nextControl,
      "restart",
      "Restart",
      memberSlugs.length === 0 ? summaryState : viewing(),
      memberSlugs.length === 0,
    );
    return;
  }
  const previous = next.index === 0 ? next : viewing(next.index - 1);
  const following = next.index + 1 < memberSlugs.length ? viewing(next.index + 1) : summaryState;
  setControl(previousControl, "previous", "Previous", previous, next.index === 0);
  setControl(nextControl, "next", "Next", following, false);
};

const render = (next: ProjectPlayerState) => {
  state = next;
  root.dataset.selected = next._tag === "Summary" ? "summary" : (memberSlugs[next.index] ?? "");
  const fragmentId = next._tag === "Summary" ? "project-summary" : `project-member-${next.index}`;
  const template = root.querySelector<HTMLTemplateElement>(`#${fragmentId}`);
  if (!template) return;
  const content = template.content.cloneNode(true);
  if (!(content instanceof DocumentFragment)) return;
  const meta = content.querySelector<HTMLElement>("[data-member-meta]");
  stage.replaceChildren(content);
  if (meta) {
    title.textContent = meta.dataset.title ?? "";
    description.textContent = meta.dataset.description ?? "";
    position.textContent = meta.dataset.position ?? "";
  }
  root.querySelectorAll<HTMLAnchorElement>("[data-project-member]").forEach((link) => {
    const active = link.dataset.projectMember === root.dataset.selected;
    link.toggleAttribute("aria-current", active);
    link.classList.toggle("is-active", active);
  });
  renderControls(next);
  status.textContent =
    next._tag === "Summary" ? "Project complete" : `Showing ${position.textContent}`;
};

const navigate = (event: ProjectPlayerEvent, history: "push" | "none") => {
  const next = transition(state, event, memberSlugs.length);
  if (statesEqual(next, state)) return;
  render(next);
  if (history === "push")
    window.history.pushState({ project: root.dataset.selected }, "", urlFor(next));
};

root.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest<HTMLElement>("[data-project-action], [data-project-member]");
  if (!target) return;
  if (target.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    return;
  }
  const action = target.dataset.projectAction;
  const index = target.dataset.projectIndex;
  if (!action && index === undefined) return;
  event.preventDefault();
  if (index !== undefined) navigate({ _tag: "Select", index: Number(index) }, "push");
  else if (action === "previous") navigate({ _tag: "Previous" }, "push");
  else if (action === "next") navigate({ _tag: "Next" }, "push");
  else if (action === "restart") navigate({ _tag: "Restart" }, "push");
});

stage.addEventListener(
  "ended",
  () => {
    const isTimed = state._tag === "Viewing" && isTimedKind(memberKinds[state.index]);
    navigate({ _tag: "Ended", isTimed }, "push");
  },
  true,
);

window.addEventListener("popstate", () => {
  const restored = stateForProjectPath(window.location.pathname, projectSlug, memberSlugs);
  if (restored !== null && !statesEqual(restored, state)) render(restored);
});

render(state);

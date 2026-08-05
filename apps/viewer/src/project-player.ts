import { Match as M } from "effect";

export type ProjectPlayerState =
  | { readonly _tag: "Viewing"; readonly index: number }
  | { readonly _tag: "Summary" };

export type ProjectPlayerEvent =
  | { readonly _tag: "Select"; readonly index: number }
  | { readonly _tag: "Previous" }
  | { readonly _tag: "Next" }
  | { readonly _tag: "Ended"; readonly isTimed: boolean }
  | { readonly _tag: "Pause" }
  | { readonly _tag: "Seek" }
  | { readonly _tag: "TimeUpdate" }
  | { readonly _tag: "Restart" };

/** Create a viewing state for a project member. */
export const viewing = (index = 0): ProjectPlayerState => ({ _tag: "Viewing", index });
export const summary: ProjectPlayerState = { _tag: "Summary" };

/** Whether a member kind emits a completion event that may advance project playback. */
export const isTimedKind = (kind: string | undefined): boolean =>
  kind === "audio" || kind === "video";

/** Compare player states to avoid redundant render and history work. */
export const statesEqual = (left: ProjectPlayerState, right: ProjectPlayerState): boolean =>
  left._tag === right._tag && (left._tag === "Summary" || left.index === right.index);

const next = (index: number, memberCount: number): ProjectPlayerState =>
  index + 1 < memberCount ? viewing(index + 1) : summary;

/** Pure, total project playback transition. Only an ended timed member advances automatically. */
export const transition = (
  state: ProjectPlayerState,
  event: ProjectPlayerEvent,
  memberCount: number,
): ProjectPlayerState => {
  if (memberCount === 0) return summary;
  return M.value(event).pipe(
    M.tagsExhaustive({
      Select: ({ index }) => (index >= 0 && index < memberCount ? viewing(index) : state),
      Restart: () => viewing(),
      Previous: () =>
        state._tag === "Summary"
          ? viewing(memberCount - 1)
          : state.index > 0
            ? viewing(state.index - 1)
            : state,
      Next: () => (state._tag === "Viewing" ? next(state.index, memberCount) : viewing()),
      Ended: ({ isTimed }) =>
        isTimed && state._tag === "Viewing" ? next(state.index, memberCount) : state,
      Pause: () => state,
      Seek: () => state,
      TimeUpdate: () => state,
    }),
  );
};

/** `null` means an invalid member route and must not be silently changed by popstate. */
export const stateForRoute = (
  memberSlug: string | null,
  memberSlugs: ReadonlyArray<string>,
): ProjectPlayerState | null => {
  if (memberSlug === "summary") return summary;
  if (memberSlug === null) return memberSlugs.length === 0 ? summary : viewing();
  const index = memberSlugs.indexOf(memberSlug);
  return index === -1 ? null : viewing(index);
};

/** Parse a browser path only when it is an exact route for this project. */
export const stateForProjectPath = (
  pathname: string,
  projectSlug: string,
  memberSlugs: ReadonlyArray<string>,
): ProjectPlayerState | null => {
  const segments = pathname.split("/");
  if (segments[0] !== "" || segments[1] !== "p" || segments[2] !== projectSlug) return null;
  const routeSegments = segments.slice(3);
  if (routeSegments[routeSegments.length - 1] === "") routeSegments.pop();
  if (routeSegments.length > 1 || routeSegments.some((segment) => segment === "")) return null;
  return stateForRoute(routeSegments[0] ?? null, memberSlugs);
};

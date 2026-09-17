/**
 * "Is this a phone?", for the handful of decisions CSS cannot make.
 *
 * Almost everything responsive here belongs in `base.css` and stays there — the
 * stylesheet has two width queries and that is the point. This exists for the
 * things a media query cannot reach at all: a `placeholder` is an attribute, not
 * a box, so it cannot be swapped by width without JavaScript asking.
 *
 * `useSyncExternalStore` rather than an effect and a state: it subscribes to the
 * same `MediaQueryList` the stylesheet is matching against, so there is no
 * render where the component believes one thing and the layout shows another,
 * and no listener left behind. The server snapshot answers "not matching",
 * which is right for a client-only app — it is only ever read if this is ever
 * prerendered, and the wide string is the safe one to start from.
 */

import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = globalThis.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Narrow enough that a two-control filter row leaves the search box short. Not
 * one of the stylesheet's breakpoints and deliberately not added to it: nothing
 * about the *layout* changes here, only how much a placeholder can say.
 */
export const PHONE_QUERY = "(max-width: 640px)";

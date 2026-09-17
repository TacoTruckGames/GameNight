/**
 * Freeze the page behind a modal, and put it back exactly where it was.
 *
 * A scrim is paint. It dims the board and catches clicks, and it does nothing
 * at all about a finger dragged across it, a wheel turned over it, or Page Down
 * — all three scroll the page underneath, so the "background" quietly moves
 * while a dialog sits on top of it claiming to be modal.
 *
 * ## Why `position: fixed` and not `overflow: hidden`
 *
 * `overflow: hidden` on `<body>` is the tidier lock and it does not hold on
 * iOS Safari, which is the browser this app is mostly used in: the page keeps
 * panning, and the rubber-band at the end of a drag leaves a gap above the
 * sheet. Pinning the body takes the document out of the scrollable world
 * entirely, so there is nothing left to pan.
 *
 * The cost is that pinning it also scrolls it to the top, which would throw the
 * board away behind the sheet and land the reader somewhere else when they
 * closed it. `top: -<scrollY>px` holds the page exactly where it was, and the
 * release scrolls back to the same offset — so the lock is invisible in both
 * directions.
 *
 * The scrollbar is the other half of this. A pinned body is not a scrolling
 * document, so a classic scrollbar would vanish and every fixed bar on screen
 * would jump sideways by its width at the moment the sheet opened.
 * `html { scrollbar-gutter: stable }` in `base.css` holds that column open at
 * all times — it is also what keeps the board from shifting when a view
 * switches from short to long — so the pin removes nothing and this module
 * has nothing to reserve. See `src/lib/scrollbar.ts` for how the bars extend
 * under the reserved column.
 *
 * ## Counted, not a boolean
 *
 * Two locks can overlap — a sheet open while something else claims one, or
 * StrictMode mounting an effect twice in development — and a naive release
 * would unpin the page with a dialog still on screen. The count is module-level
 * because the thing being locked is: there is one document.
 */

import { useEffect } from "react";

let depth = 0;
let release: (() => void) | null = null;

function lock() {
  if (depth++ > 0) return;

  const { body } = document;
  const y = window.scrollY;
  const previous = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  };
  body.style.position = "fixed";
  body.style.top = `-${y}px`;
  body.style.left = "0";
  body.style.right = "0";
  // A fixed box shrinks to its content without this, and the page behind would
  // visibly reflow to a narrower column the instant the sheet opened.
  body.style.width = "100%";

  release = () => {
    Object.assign(body.style, previous);
    window.scrollTo(0, y);
  };
}

function unlock() {
  if (depth === 0) return;
  if (--depth > 0) return;
  release?.();
  release = null;
}

/** Locks for as long as the calling component is mounted. */
export function useScrollLock() {
  useEffect(() => {
    lock();
    return unlock;
  }, []);
}

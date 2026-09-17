/**
 * A bottom sheet you can throw away.
 *
 * Dismissal is the same set the identity switcher uses, so "put this back"
 * means one thing across the app: Escape, a tap outside, and — on a phone,
 * where those two are a keyboard and a small target — **a drag downward**.
 * There is still no Close button; a fourth way to say it would be a control
 * spending the sheet's first row.
 *
 * ## Why this is a native listener and not an `onTouchMove` prop
 *
 * The sheet's body scrolls, so the browser treats a vertical drag inside it as
 * a scroll and claims the gesture — cancelling our pointer before we see a
 * second move. That is why the first version of this only worked on the grip:
 * the grip carries `touch-action: none` and so is the one place the browser
 * never claims. Everywhere else the drag died on contact.
 *
 * Taking the gesture back needs `preventDefault()` on `touchmove`, and React
 * registers `touchmove` as **passive**, where `preventDefault()` does nothing
 * at all. So the touch path is a native listener with `{ passive: false }`,
 * attached by hand. Pointer events still cover the mouse — one extra path, and
 * the only reason a headless browser can test any of this.
 *
 * ## What the gesture must not break
 *
 * It must not eat the scroll. The direction is decided once, on the first
 * meaningful move, and locked for the rest of the gesture: downward from the
 * top of the body is a dismissal, anything else is a scroll and is never
 * intercepted again. So a drag taken halfway through reading an event scrolls,
 * and a drag taken at the top throws the sheet away — from anywhere on the
 * panel, not just from the handle.
 *
 * It engages visually after 6px, so a tap is still a tap and its click goes
 * through. Past that the click is swallowed once on release — otherwise
 * flicking the sheet away from over a button would press that button.
 *
 * Release decides on distance *or* speed. 110px is a deliberate throw; a short
 * flick is also a deliberate throw, and refusing it because the finger did not
 * travel far enough is the thing that makes a sheet feel stuck.
 *
 * ## `setPointerCapture` is called late, and that is load-bearing
 *
 * Capturing on `pointerdown` — which an earlier version of this did — retargets
 * the click that follows onto the capturing element. Every button and link
 * inside the sheet then stops working, silently, because their clicks are being
 * delivered to the panel instead. Capture happens the moment a drag *engages*,
 * so a press that never became a drag is left entirely alone.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** A deliberate throw, in px. */
const DISMISS_DISTANCE = 110;
/** …or a short, fast one: px travelled, and px/ms at release. */
const FLICK_DISTANCE = 40;
const FLICK_VELOCITY = 0.5;
/** Below this the sheet does not move, so a tap stays a tap. */
const ENGAGE = 6;
/** Enough movement to tell a drag's direction from a wobble. */
const DIRECTION = 3;

type Gesture = {
  from: number;
  last: number;
  at: number;
  velocity: number;
  /** null until the first meaningful move decides, then locked. */
  mode: "dismiss" | "scroll" | null;
  /** The pointer has been captured; do not ask for it twice. */
  captured: boolean;
};

export function Sheet({
  label,
  onClose,
  children,
}: {
  /** Names the dialog for a screen reader — the event's title. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);

  // `onClose` is a fresh closure every render, and the native listeners below
  // must not be torn down and re-attached for that. One ref, read at call time.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A callback ref, not `useRef` + an effect: the caller may still be loading
  // when this mounts, so an effect that ran once would focus nothing.
  const attach = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    node?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Shared by both input paths. Returns the px the sheet should sit at. */
  const begin = (y: number, target: EventTarget | null, timeStamp: number) => {
    const onGrip = (target as HTMLElement | null)?.closest(".sheet__grip") != null;
    // Mid-read, the body is a scroll container first and a sheet second — the
    // grip is the deliberate exception, which is what a grip is for.
    if (!onGrip && (bodyRef.current?.scrollTop ?? 0) > 0) return false;
    gesture.current = { from: y, last: y, at: timeStamp, velocity: 0, mode: onGrip ? "dismiss" : null, captured: false };
    return true;
  };

  /** True when the caller should stop the browser doing its own thing. */
  const move = (y: number, timeStamp: number): boolean => {
    const g = gesture.current;
    if (!g) return false;

    const dy = y - g.from;
    const dt = timeStamp - g.at;
    if (dt > 0) g.velocity = (y - g.last) / dt;
    g.last = y;
    g.at = timeStamp;

    // One decision, then locked: a gesture that started as a scroll stays one.
    if (g.mode === null) {
      if (Math.abs(dy) < DIRECTION) return false;
      g.mode = dy > 0 ? "dismiss" : "scroll";
    }
    if (g.mode === "scroll") return false;

    if (dy < ENGAGE) {
      if (dragging) setDragY(0);
      return true;
    }
    if (!dragging) setDragging(true);
    swallowClick.current = true;
    setDragY(dy - ENGAGE);
    return true;
  };

  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    const travelled = dragY;
    setDragging(false);
    setDragY(0);
    if (!g || g.mode !== "dismiss") return;
    if (travelled >= DISMISS_DISTANCE || (travelled >= FLICK_DISTANCE && g.velocity >= FLICK_VELOCITY)) {
      closeRef.current();
    }
  };

  // The touch path, by hand, because React's `touchmove` is passive.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      begin(event.touches[0]!.clientY, event.target, event.timeStamp);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const ours = move(event.touches[0]!.clientY, event.timeStamp);
      // Only while the gesture is ours, and only while it still can be: once
      // the browser has committed to scrolling, the event is not cancelable and
      // calling this would be a console warning and nothing else.
      if (ours && event.cancelable) event.preventDefault();
    };
    const onTouchEnd = () => end();

    panel.addEventListener("touchstart", onTouchStart, { passive: true });
    panel.addEventListener("touchmove", onTouchMove, { passive: false });
    panel.addEventListener("touchend", onTouchEnd);
    panel.addEventListener("touchcancel", onTouchEnd);
    return () => {
      panel.removeEventListener("touchstart", onTouchStart);
      panel.removeEventListener("touchmove", onTouchMove);
      panel.removeEventListener("touchend", onTouchEnd);
      panel.removeEventListener("touchcancel", onTouchEnd);
    };
    // `begin`/`move`/`end` close over `dragging` and `dragY`, which change while
    // a drag is in flight — re-attaching mid-gesture would drop it. They are
    // re-created every render on purpose and the listeners re-bound with them.
  });

  // The mouse path. Touch is handled above; taking it here too would run the
  // whole gesture twice.
  const mouseOnly = (event: React.PointerEvent) => event.pointerType !== "touch";

  return (
    <>
      <div
        className="sheet__scrim"
        style={dragY ? { opacity: 1 - Math.min(dragY / 320, 1) * 0.7 } : undefined}
        onClick={onClose}
      />
      <div
        className={`sheet${dragging ? " sheet--dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={attach}
        tabIndex={-1}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        onPointerDown={(event) => {
          if (!mouseOnly(event) || event.button !== 0) return;
          begin(event.clientY, event.target, event.timeStamp);
        }}
        onPointerMove={(event) => {
          if (!mouseOnly(event)) return;
          move(event.clientY, event.timeStamp);
          // Late, and only once the drag is real — see the header. Capturing on
          // the press would retarget the click and kill every control in here.
          const g = gesture.current;
          if (g && g.mode === "dismiss" && !g.captured && dragY > 0) {
            g.captured = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerUp={(event) => {
          if (mouseOnly(event)) end();
        }}
        onPointerCancel={(event) => {
          if (mouseOnly(event)) end();
        }}
        onClickCapture={(event) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <span className="sheet__grip" aria-hidden="true" />
        <div className="sheet__body stack stack--loose" ref={bodyRef}>
          {children}
        </div>
      </div>
    </>
  );
}

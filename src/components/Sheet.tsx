/**
 * A bottom sheet you can throw away.
 *
 * Three ways to dismiss, and they are the same three the identity switcher
 * uses, so "put this back" means one thing across the app: Escape, a tap
 * outside, and — on a phone, where the other two are a keyboard and a small
 * target — **a drag downward**. There is still no Close button; a fourth way to
 * say it would be a control spending the sheet's first row.
 *
 * ## The gesture, and what it has to avoid
 *
 * The sheet scrolls. A drag that starts while it is scrolled down has to be a
 * scroll, or the event you are halfway through reading leaves the screen. So a
 * drag is only allowed to *begin* at `scrollTop === 0`, or anywhere on the grip
 * — which is what the grip is for, and why it carries `touch-action: none`: it
 * opts out of the browser's own panning so the handle always answers.
 *
 * Which is also why the grip is **outside** the scrolling part. It began inside
 * it, and scrolled away with the content: the one control that is supposed to
 * work however far down you are was the first thing to leave. The panel is a
 * flex column that does not scroll, holding a fixed grip and a body that does.
 *
 * It engages after 6px, not immediately, so a tap is still a tap: below that
 * threshold nothing moves and the click goes through to whatever was pressed.
 * Past it, the click is swallowed once on the way up — otherwise flicking the
 * sheet away from over a button would press that button on release.
 *
 * Release decides by distance *or* speed. 110px is a deliberate throw; a short
 * flick is also a deliberate throw, and refusing it because the finger did not
 * travel far enough is the thing that makes a sheet feel stuck. Anything else
 * snaps back, and `prefers-reduced-motion` gets the snap without the animation.
 *
 * Pointer events rather than touch events: one code path covers a finger, a
 * trackpad and a mouse, which is also the only reason this is testable in a
 * headless browser at all.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** A deliberate throw, in px. */
const DISMISS_DISTANCE = 110;
/** …or a short, fast one: px travelled, and px/ms at release. */
const FLICK_DISTANCE = 40;
const FLICK_VELOCITY = 0.5;
/** Below this, it is a tap and nothing moves. */
const ENGAGE = 6;

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
  const gesture = useRef<{ id: number; from: number; last: number; at: number; velocity: number } | null>(null);
  const swallowClick = useRef(false);

  // A callback ref, not `useRef` + an effect: the sheet's caller may still be
  // loading when this mounts, so an effect that runs once would focus nothing.
  const attach = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    node?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelRef.current || event.button !== 0) return;
    const onGrip = (event.target as HTMLElement).closest(".sheet__grip") !== null;
    // Mid-read, the body is a scroll container first and a sheet second.
    if (!onGrip && (bodyRef.current?.scrollTop ?? 0) > 0) return;
    gesture.current = { id: event.pointerId, from: event.clientY, last: event.clientY, at: event.timeStamp, velocity: 0 };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || event.pointerId !== g.id) return;

    const dy = event.clientY - g.from;
    const dt = event.timeStamp - g.at;
    if (dt > 0) g.velocity = (event.clientY - g.last) / dt;
    g.last = event.clientY;
    g.at = event.timeStamp;

    // Upward drags do nothing: this sheet has no expanded state to pull into.
    if (dy < ENGAGE) {
      if (dragging) setDragY(0);
      return;
    }
    if (!dragging) {
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    swallowClick.current = true;
    setDragY(dy - ENGAGE);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || event.pointerId !== g.id) return;
    const travelled = dragY;
    setDragging(false);
    setDragY(0);
    if (travelled >= DISMISS_DISTANCE || (travelled >= FLICK_DISTANCE && g.velocity >= FLICK_VELOCITY)) onClose();
  };

  // The scrim thins out as the sheet leaves, so the board is already coming back
  // before the finger lifts — and a drag that snaps back never looked committed.
  const progress = Math.min(dragY / 320, 1);

  return (
    <>
      <div
        className="sheet__scrim"
        style={dragY ? { opacity: 1 - progress * 0.7 } : undefined}
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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

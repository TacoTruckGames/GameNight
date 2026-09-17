/**
 * How wide the scrollbar's column is, as a CSS variable.
 *
 * `html { scrollbar-gutter: stable }` reserves the column whether or not the
 * page currently scrolls, so switching from a short view to a long one — the
 * board's Week to its List — no longer shifts the whole page sideways by a
 * scrollbar's width. The cost of reserving it is a strip down the right edge
 * that the full-bleed bars would otherwise stop short of; they extend under it
 * by exactly this much (`--scrollbar-gutter`, in `base.css`) and pad their
 * content by the same, so nothing centred moves.
 *
 * Measured, not assumed: on a Mac with overlay scrollbars, and on every phone,
 * the column is 0px and none of this does anything. On a classic-scrollbar
 * platform — Windows, or a Mac set to always show them — it is ~15px. With
 * the gutter reserved it is that width at all times, scrolling or not, which
 * is what makes it safe to read once and on resize.
 *
 * The width is the window's minus the root element's *laid-out* width. Not
 * `clientWidth`: Chrome keeps reporting the full viewport there while the
 * reserved column has already taken 15px off everything in flow, and a
 * measurement that says 0 while the body says 15 is how the bars stopped short.
 */
export function trackScrollbarGutter(): () => void {
  const root = document.documentElement;
  const measure = () => {
    root.style.setProperty("--scrollbar-gutter", `${Math.max(0, window.innerWidth - root.offsetWidth)}px`);
  };
  measure();
  window.addEventListener("resize", measure);
  return () => window.removeEventListener("resize", measure);
}

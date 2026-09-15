/**
 * The Game Night mark: a die whose visible face shows a crescent moon in place
 * of the pips, with a single pip left in the corner — games, at night.
 *
 * Inline SVG rather than an image file so it inherits `currentColor` (white on
 * the brand band, accent elsewhere), stays crisp at any size and costs no
 * request. Drawn as one `evenodd` path — the rounded square is the fill and the
 * crescent and pip are holes punched through it — so the same `d` works as a
 * favicon and in any single-colour context. The crescent is a circle (r 8.3)
 * minus a smaller circle (r 6.76) offset up and to the right; geometry is
 * chosen so both cut-outs still read at 16 px.
 *
 * Decorative by default — the wordmark next to it carries the name — so pass
 * `title` only where the mark stands alone.
 */

const MARK =
  "M8 2h16a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6Z" +
  "m9.94 4.95a8.3 8.3 0 1 0 6.67 11.56 6.76 6.76 0 1 1-6.67-11.56Z" +
  "M5.2 25.4a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0Z";

export function Logo({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fillRule="evenodd" d={MARK} />
    </svg>
  );
}

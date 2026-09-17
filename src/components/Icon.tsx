/**
 * The whole icon set, ten glyphs, applied as CSS masks.
 *
 * A mask rather than an `<img>` because the same file then paints in
 * `currentColor` — muted in an inactive tab, accent in the active one, white on
 * the brand band, danger inside an error banner — so dark mode needs no second
 * set of assets.
 *
 * Icons here always sit next to their own label, so they are `aria-hidden`
 * unless `label` is passed.
 */

import type { CSSProperties } from "react";

export type IconName =
  "events" | "player" | "organize" | "search" | "seat" | "full" | "in" | "empty" | "alert" | "shield";

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <span
      className="icon"
      style={{ "--icon": `url(/icons/${name}.png)`, width: size, height: size } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

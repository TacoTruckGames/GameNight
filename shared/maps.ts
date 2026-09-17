/**
 * The maps feature's two shared numbers, imported by both sides so they cannot
 * drift. Each used to live twice — once in the Worker as the rule, once in the
 * client as a constant with a comment saying "must match the Worker".
 */

/**
 * The only sizes the map routes render, and the reason they are not an open
 * image proxy: an unbounded `?w=&h=` lets anyone mint unlimited distinct cache
 * keys, and every miss is a billed render. The client asks for the first.
 */
export const MAP_PRESETS = [
  { width: 640, height: 320 }, // the sheet and the posting form, full width
  { width: 320, height: 180 }, // a narrow column or compact card
] as const;

export type MapPreset = (typeof MAP_PRESETS)[number];

/** The size the client renders at, at `scale=2`. */
export const MAP_SIZE: MapPreset = MAP_PRESETS[0];

/** Shorter than this, `GET /api/places/suggest` answers `[]` without calling out — and the client does not ask. */
export const SUGGEST_MIN = 3;

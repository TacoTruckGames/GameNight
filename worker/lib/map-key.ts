/**
 * The cache key for a rendered map, built from the *parsed* request.
 *
 * It used to be `c.req.url`. That made the key whatever the caller typed:
 * `?w=640&h=320` and `?h=320&w=640` were two keys, `&x=1`, `&x=2`, `&x=3` were
 * three more, and `w=0640` another — each a miss that reached D1 and then
 * Google, on an unauthenticated route, until the day's map budget was gone and
 * every real user lost their maps. Parsing first and keying on the values
 * means there is exactly one key per (event, size, venue), which is also the
 * number of images that can exist.
 */

export interface MapSize {
  width: number;
  height: number;
  scale: 1 | 2;
}

export function eventMapKey(origin: string, eventId: string, size: MapSize, version: string): string {
  const params = new URLSearchParams({ w: String(size.width), h: String(size.height), scale: String(size.scale), v: version });
  return `${origin}/api/events/${encodeURIComponent(eventId)}/map?${params.toString()}`;
}

export function previewMapKey(origin: string, query: string, size: MapSize): string {
  const params = new URLSearchParams({ q: query.trim(), w: String(size.width), h: String(size.height), scale: String(size.scale) });
  return `${origin}/api/places/map?${params.toString()}`;
}

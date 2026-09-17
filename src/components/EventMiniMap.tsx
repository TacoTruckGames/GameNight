/**
 * A static map of the venue, and a tap straight into navigation.
 *
 * Three things keep it cheap and quiet:
 *   - the image is served by our own Worker (`/api/events/:id/map`), so the
 *     Google key never reaches the browser and the SPA keeps its "zero
 *     cross-origin requests" property;
 *   - `width`/`height` are fixed attributes matching the requested size, so the
 *     image reserves its box before it loads and nothing on the page jumps;
 *   - `onError` hides it entirely. The route answers 503 when maps are over
 *     budget or upstream is down, and a broken-image icon would advertise a
 *     failure the reader can do nothing about. A missing garnish is invisible;
 *     a broken one is a bug report.
 */

import { useEffect, useState } from "react";
import { MAP_SIZE } from "../../shared/maps";
import type { EventPlace } from "../../shared/api-types";
import { mapsDirectionsUrl } from "../../shared/maps-links";

// The size is the Worker's rule, imported: `shared/maps.ts`.
const { width: WIDTH, height: HEIGHT } = MAP_SIZE;

export function EventMiniMap({
  eventId,
  place,
  location,
}: {
  eventId: string;
  place: EventPlace;
  location: string;
}) {
  const [failed, setFailed] = useState(false);

  // `v` is the place id: it busts the cache when an admin re-points a venue,
  // and it is checked server-side, so it also bounds how many distinct cache
  // keys a stranger can mint on our key.
  const src = `/api/events/${encodeURIComponent(eventId)}/map?w=${WIDTH}&h=${HEIGHT}&scale=2&v=${encodeURIComponent(place.id)}`;

  useEffect(() => setFailed(false), [src]);

  if (failed) return null;

  return (
    <a
      className="minimap"
      href={mapsDirectionsUrl({ location, place })}
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        className="minimap__img"
        src={src}
        width={WIDTH}
        height={HEIGHT}
        loading="lazy"
        decoding="async"
        alt={`Map showing ${location}`}
        onError={() => setFailed(true)}
      />
      <span className="visually-hidden">Open directions in Google Maps</span>
    </a>
  );
}

/**
 * The venue, on a map, while it is still being typed.
 *
 * `EventMiniMap` cannot do this: it is keyed by event id, and a form has none
 * yet. So this asks `/api/places/map`, which takes the label the picker put in
 * the field — Static Maps geocodes it inside the same billed request, so the
 * preview costs one map and no Place Details, and returns the byte-identical
 * image the stored coordinates would.
 *
 * ## Why this fetches instead of setting `src`
 *
 * A route that renders any string is an open proxy where every distinct string
 * is a fresh billed render; the event map avoids that by being bound to a real
 * event id and a matching `place_id`. This one has no id to bind to, so it is
 * gated to organizers instead — and an `<img src>` cannot send `X-User-Id`, so
 * a plain `<img>` pointed at it answers 401 forever.
 *
 * Fetching it by hand carries the header and keeps the gate. The long
 * `Cache-Control` still applies, so a second look at the same venue is served
 * by the browser without touching the network; the object URL is revoked on
 * every change, because a leaked blob is a leak that lasts the whole session.
 *
 * Only rendered once a suggestion has been *selected*, so the string being
 * geocoded is Google's own name for a place it just offered — not whatever
 * half-typed thing is in the box.
 */

import { useEffect, useState } from "react";
import { mapsSearchFor } from "../../shared/maps-links";
import { useIdentity } from "../identity/IdentityContext";

/** Must be one of `MAP_PRESETS` in `worker/routes/places.ts`; anything else is a 400. */
const WIDTH = 640;
const HEIGHT = 320;

export function PlacePreviewMap({ query, placeId }: { query: string; placeId: string | null }) {
  const { userId } = useIdentity();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || query.trim() === "") return;
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const src = `/api/places/map?q=${encodeURIComponent(query)}&w=${WIDTH}&h=${HEIGHT}&scale=2`;
    void fetch(src, { headers: { "X-User-Id": userId }, signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      // The same silence `EventMiniMap` keeps: the route answers 503 when maps
      // are over budget or upstream is down, and a broken image in the middle of
      // a form reads as "your venue is wrong" rather than "our map is missing".
      .catch(() => {});

    return () => {
      controller.abort();
      setUrl(null);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [query, userId]);

  if (url === null) return null;

  // Tappable, like every other map in the app: a picture of a place you cannot
  // open is a picture. Search rather than directions, because at this point the
  // organizer is checking they picked the right building, not driving to it —
  // and the place id makes that check exact rather than a "did you mean".
  return (
    <a
      className="minimap place-preview"
      href={mapsSearchFor(query, placeId)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        className="minimap__img"
        src={url}
        width={WIDTH}
        height={HEIGHT}
        decoding="async"
        alt={`Map showing ${query}`}
      />
      <span className="visually-hidden"> — opens in Google Maps</span>
    </a>
  );
}

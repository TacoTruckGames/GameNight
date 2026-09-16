/**
 * Deep links into Google Maps.
 *
 * These cost nothing and need no API key — they are the free half of this
 * feature, and the half that does the most for the phone user the brief calls
 * the primary one. Google's documented `api=1` URLs open the **native Maps app**
 * on both Android and iOS, falling back to the web elsewhere, so one URL covers
 * every platform.
 *
 * No Apple Maps branch, deliberately. Picking between two links needs user-agent
 * sniffing (`navigator.platform` is deprecated and `maxTouchPoints` heuristics
 * are wrong on iPads and touch-screen Macs), and a bare `maps.apple.com?q=` has
 * no equivalent of `query_place_id`, so it can land on the wrong branch of a
 * chain. An iPhone user who prefers Apple Maps can long-press the link. If that
 * trade ever changes, the Apple form is `?q=<label>&ll=<lat>,<lng>`.
 */

import type { EventPlace } from "./api-types";

/** Just the parts of an event a link needs — so tests can pass a literal. */
export interface MappableEvent {
  location: string;
  place: EventPlace | null;
}

const SEARCH = "https://www.google.com/maps/search/";
const DIRECTIONS = "https://www.google.com/maps/dir/";

/**
 * The canonical address when Google confirmed one, else whatever the organizer
 * typed. A free-text label still searches usefully — that is why an event with
 * no verified place is still worth linking.
 */
function query(event: MappableEvent): string {
  return event.place?.address ?? event.location;
}

/**
 * The place id to disambiguate with, or `null` to search by address alone.
 *
 * The demo seed stores `seed_place_*` placeholders rather than real ids: nobody
 * can call the Places API from a `.sql` file, and fabricating a Google-shaped id
 * would be a lie sitting in the database waiting for someone to trust it. But
 * handing such an id to Maps asks it to disambiguate against something Google
 * never issued, and the result is undefined. The address query on its own is
 * accurate, so placeholders are simply dropped from the link.
 */
const PLACEHOLDER_ID = /^seed_place_/;

function disambiguator(event: MappableEvent): string | null {
  if (!event.place) return null;
  return PLACEHOLDER_ID.test(event.place.id) ? null : event.place.id;
}

/** Opens the venue in Maps. */
export function mapsSearchUrl(event: MappableEvent): string {
  const params = new URLSearchParams({ api: "1", query: query(event) });
  // A place id makes the destination exact: no "did you mean", and the right
  // branch of a chain with six locations in one city.
  const placeId = disambiguator(event);
  if (placeId) params.set("query_place_id", placeId);
  return `${SEARCH}?${params.toString()}`;
}

/**
 * Opens turn-by-turn navigation to the venue. `travelmode` is deliberately
 * omitted so Maps uses whatever the person last used — we do not know whether
 * they are driving, cycling or taking a bus to game night.
 */
export function mapsDirectionsUrl(event: MappableEvent): string {
  const params = new URLSearchParams({ api: "1", destination: query(event) });
  const placeId = disambiguator(event);
  if (placeId) params.set("destination_place_id", placeId);
  return `${DIRECTIONS}?${params.toString()}`;
}

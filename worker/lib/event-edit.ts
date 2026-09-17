/**
 * The one way an event's fields change after it is posted.
 *
 * Two routes take a patch — the owning organizer's `PATCH /events/:id` and the
 * operator's `PATCH /admin/events/:id` — and they used to carry this pipeline
 * twice, verbatim: the capacity floor, the room rotation, the venue lookup and
 * the write. What actually differs between them is who may call and what
 * happens afterwards (the admin audits; the organizer is refused on a
 * cancelled event), so that is all the routes keep.
 *
 * Order is load-bearing. The floor is checked before anything is resolved,
 * because it is a field error and should cost nothing. The venue is resolved
 * *before* the UPDATE, so a failed lookup writes nothing at all. The room key
 * rotates in the same UPDATE as the capacity, so the two can never disagree.
 */

import type { Context } from "hono";

import type { EventPatch } from "../../shared/schemas";
import { updateEvent } from "../db/queries";
import type { AppEnv } from "./context";
import { ApiError, fieldError } from "./errors";
import { resolvePlaceForPatch } from "./places";
import { newRoomKey } from "./room";
import { toIsoSeconds } from "./time";

/** The two columns the pipeline reads off the current row. */
export interface PatchableRow {
  rsvp_count: number;
  capacity: number;
}

export async function applyEventPatch(
  c: Context<AppEnv>,
  id: string,
  row: PatchableRow,
  patch: EventPatch,
): Promise<{ changed: string[]; rotated: boolean }> {
  // `events.rsvp_count <= capacity` is a CHECK constraint, so without this the
  // honest mistake "shrink the room" arrives as an opaque 500. It is a field
  // error, on the field.
  if (patch.capacity !== undefined && patch.capacity < row.rsvp_count) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "Please fix the highlighted fields.",
      fieldError("capacity", `Capacity can't be below the ${row.rsvp_count} current attendees`),
    );
  }

  // A hydrated `EventRoom` caches capacity and answers "full" from that cache
  // without reading D1, so a raise would be invisible to the players it was
  // for. A rotated key names a room that does not exist yet; it hydrates from
  // D1 — the new capacity — on its next call.
  const rotate = patch.capacity !== undefined && patch.capacity !== row.capacity ? newRoomKey() : null;

  // Resolved *before* the UPDATE, so a failed lookup writes nothing at all.
  const place = await resolvePlaceForPatch(c, patch.placeId, patch.placeSessionToken);

  const changed = await updateEvent(
    c.env.DB,
    id,
    // Normalise to the one storage format, whatever offset the client sent.
    { ...patch, ...(patch.startsAt !== undefined ? { startsAt: toIsoSeconds(new Date(patch.startsAt)) } : {}) },
    rotate,
    place,
  );
  return { changed, rotated: rotate !== null };
}

/**
 * The two things an organizer can do to an event that are not edits.
 *
 * **Cancel** is always offered. It is a status change, never a delete: the seats
 * stay on record, and every player who held one sees the event marked cancelled
 * in their own list rather than watching it disappear. The confirmation names
 * how many people that is, because that number is the whole cost of the tap.
 *
 * **Delete** is offered only while nobody has a seat. Then there is no one to
 * tell, and "delete" is the honest verb for an event posted by mistake. The
 * moment someone joins, the control is gone — the server would refuse it with
 * a 409 anyway, but a button that exists only to say no is worse than no
 * button.
 *
 * Both confirm inline rather than through `window.confirm`: the browser's
 * dialog cannot be styled, cannot name the count, and on a phone arrives
 * looking like a system error.
 */

import { useState } from "react";
import type { EventSummary } from "../../shared/api-types";
import { useCancelEvent, useDeleteEvent } from "../api/hooks";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";

export function EventDangerZone({
  event,
  onCancelled,
  onDeleted,
}: {
  event: EventSummary;
  onCancelled: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const cancel = useCancelEvent(event.id);
  const remove = useDeleteEvent(event.id);
  const [arming, setArming] = useState<"cancel" | "delete" | null>(null);
  const pending = cancel.isPending || remove.isPending;
  const people = event.attendeeCount === 1 ? "1 person" : `${event.attendeeCount} people`;

  return (
    <section className="danger" aria-label="Cancel or delete this event">
      {arming === "cancel" ? (
        <div className="danger__confirm">
          <p className="danger__text">
            {event.attendeeCount > 0
              ? `Cancel this event? ${people} will see it marked cancelled in their list.`
              : "Cancel this event? It comes off the board and stays on your list as cancelled."}
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn--danger"
              disabled={pending}
              onClick={() =>
                cancel.mutate(undefined, {
                  onSuccess: () => {
                    toast.show("Event cancelled.");
                    setArming(null);
                    onCancelled();
                  },
                })
              }
            >
              {cancel.isPending ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button type="button" className="btn btn--secondary" disabled={pending} onClick={() => setArming(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : arming === "delete" ? (
        <div className="danger__confirm">
          <p className="danger__text">
            Delete this event? Nobody has a seat, so there is no one to tell. This cannot be undone.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn--danger"
              disabled={pending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast.show("Event deleted.");
                    onDeleted();
                  },
                })
              }
            >
              {remove.isPending ? "Deleting…" : "Yes, delete it"}
            </button>
            <button type="button" className="btn btn--secondary" disabled={pending} onClick={() => setArming(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="form-actions">
          <button type="button" className="btn btn--danger" onClick={() => setArming("cancel")}>
            Cancel event
          </button>
          {event.attendeeCount === 0 ? (
            <button type="button" className="btn btn--danger" onClick={() => setArming("delete")}>
              Delete event
            </button>
          ) : null}
        </div>
      )}
      {cancel.error ? <ErrorBanner error={cancel.error} /> : null}
      {remove.error ? <ErrorBanner error={remove.error} /> : null}
    </section>
  );
}

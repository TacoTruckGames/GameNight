/**
 * One event, everything an operator can do to it.
 *
 * The edit form is `OrganizerPage`'s form with the same validation trio — the
 * shared zod schema runs here for a fast "capacity must be a whole number", and
 * the server's `details[{path,message}]` map onto the same fields, so the
 * capacity floor ("can't be below the 5 current attendees"), which only the
 * database can know, lands under the capacity input like any other error.
 *
 * Only the fields you actually changed are sent: a past event can have its title
 * fixed without tripping "start time must be in the future", and the audit row's
 * `changed` list stays honest.
 */

import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { AdminEventDetail } from "../../shared/api-types";
import type { GameType } from "../../shared/game-types";
import { GAME_TYPES, GAME_TYPE_LABELS, gameTypeLabel } from "../../shared/game-types";
import { CAPACITY_MAX, CAPACITY_MIN, LOCATION_MAX, TITLE_MAX, adminEventPatchSchema } from "../../shared/schemas";
import type { AdminEventPatch } from "../../shared/schemas";
import { ApiError } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { SeatChip } from "../components/SeatChip";
import { Skeleton } from "../components/Skeleton";
import {
  formatEventDateTime,
  formatEventDateTimeLong,
  isoToLocalInput,
  localInputToIso,
  toDateTimeAttr,
} from "../lib/datetime";
import { AdminPage } from "./AdminNav";
import { useAdminEvent, usePatchEvent, useRemoveAttendee, useSetEventStatus } from "./hooks";

type FieldErrors = Partial<Record<"title" | "gameType" | "startsAt" | "location" | "capacity", string>>;

const FIELDS = new Set(["title", "gameType", "startsAt", "location", "capacity"]);

function asFieldKey(path: string): keyof FieldErrors | null {
  const head = path.split(".")[0] ?? "";
  return FIELDS.has(head) ? (head as keyof FieldErrors) : null;
}

function EditForm({ event }: { event: AdminEventDetail }) {
  const patchEvent = usePatchEvent(event.id);
  const ids = {
    title: useId(),
    gameType: useId(),
    startsAt: useId(),
    location: useId(),
    capacity: useId(),
  };

  const [title, setTitle] = useState(event.title);
  const [gameType, setGameType] = useState<GameType>(event.gameType);
  const [startsAtLocal, setStartsAtLocal] = useState(() => isoToLocalInput(event.startsAt));
  const [location, setLocation] = useState(event.location);
  const [capacity, setCapacity] = useState(String(event.capacity));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  /** Whole-form complaints that belong to no single field. */
  const [formNote, setFormNote] = useState<string | null>(null);

  // A successful save refetches the event; re-sync so the inputs show what the
  // server actually stored (a trimmed title, a rounded time).
  useEffect(() => {
    setTitle(event.title);
    setGameType(event.gameType);
    setStartsAtLocal(isoToLocalInput(event.startsAt));
    setLocation(event.location);
    setCapacity(String(event.capacity));
  }, [event.title, event.gameType, event.startsAt, event.location, event.capacity]);

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);
    setFormNote(null);

    const startsAt = localInputToIso(startsAtLocal);
    const capacityNumber = capacity.trim() === "" ? Number.NaN : Number(capacity);
    const patch: Record<string, unknown> = {};
    if (title !== event.title) patch["title"] = title;
    if (gameType !== event.gameType) patch["gameType"] = gameType;
    if (startsAtLocal !== isoToLocalInput(event.startsAt)) patch["startsAt"] = startsAt ?? "";
    if (location !== event.location) patch["location"] = location;
    if (capacityNumber !== event.capacity) patch["capacity"] = capacityNumber;

    if (Object.keys(patch).length === 0) {
      setErrors({});
      setFormNote("Change at least one field first.");
      return;
    }

    const parsed = adminEventPatchSchema(new Date()).safeParse(patch);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = asFieldKey(String(issue.path[0] ?? ""));
        if (key && next[key] === undefined) next[key] = issue.message;
      }
      setErrors(next);
      if (Object.keys(next).length === 0) setFormNote(parsed.error.issues[0]?.message ?? "That change isn't valid.");
      return;
    }

    setErrors({});
    patchEvent.mutate(parsed.data as AdminEventPatch, {
      onError: (error: unknown) => {
        if (error instanceof ApiError && error.code === "VALIDATION_FAILED" && error.details) {
          const next: FieldErrors = {};
          for (const detail of error.details) {
            const key = asFieldKey(detail.path);
            if (key && next[key] === undefined) next[key] = detail.message;
          }
          setErrors(next);
          if (Object.keys(next).length > 0) return;
        }
        setFormError(error);
      },
    });
  }

  const describedBy = (field: keyof FieldErrors, id: string) => (errors[field] ? `${id}-error` : undefined);

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2 className="card__title">Edit event</h2>

      <div className="field">
        <label className="field__label" htmlFor={ids.title}>
          Title
        </label>
        <input
          id={ids.title}
          className="input"
          value={title}
          onChange={(changed) => setTitle(changed.target.value)}
          maxLength={TITLE_MAX}
          aria-invalid={errors.title !== undefined}
          aria-describedby={describedBy("title", ids.title)}
        />
        {errors.title ? (
          <p className="field__error" id={`${ids.title}-error`}>
            {errors.title}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.gameType}>
          Game type
        </label>
        <select
          id={ids.gameType}
          className="select"
          value={gameType}
          onChange={(changed) => setGameType(changed.target.value as GameType)}
          aria-invalid={errors.gameType !== undefined}
          aria-describedby={describedBy("gameType", ids.gameType)}
        >
          {GAME_TYPES.map((type) => (
            <option key={type} value={type}>
              {GAME_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {errors.gameType ? (
          <p className="field__error" id={`${ids.gameType}-error`}>
            {errors.gameType}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.startsAt}>
          Starts
        </label>
        <input
          id={ids.startsAt}
          className="input"
          type="datetime-local"
          value={startsAtLocal}
          onChange={(changed) => setStartsAtLocal(changed.target.value)}
          aria-invalid={errors.startsAt !== undefined}
          aria-describedby={describedBy("startsAt", ids.startsAt)}
        />
        <p className="text-sm muted">Your local time. Changing it must land in the future.</p>
        {errors.startsAt ? (
          <p className="field__error" id={`${ids.startsAt}-error`}>
            {errors.startsAt}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.location}>
          Location
        </label>
        <input
          id={ids.location}
          className="input"
          value={location}
          onChange={(changed) => setLocation(changed.target.value)}
          maxLength={LOCATION_MAX}
          aria-invalid={errors.location !== undefined}
          aria-describedby={describedBy("location", ids.location)}
        />
        {errors.location ? (
          <p className="field__error" id={`${ids.location}-error`}>
            {errors.location}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.capacity}>
          Capacity
        </label>
        <input
          id={ids.capacity}
          className="input"
          type="number"
          inputMode="numeric"
          min={CAPACITY_MIN}
          max={CAPACITY_MAX}
          step={1}
          value={capacity}
          onChange={(changed) => setCapacity(changed.target.value)}
          aria-invalid={errors.capacity !== undefined}
          aria-describedby={describedBy("capacity", ids.capacity)}
        />
        <p className="text-sm muted">
          <span className="tnum">{event.attendeeCount}</span> seats are taken. Raising it reopens the event for new
          RSVPs immediately.
        </p>
        {errors.capacity ? (
          <p className="field__error" id={`${ids.capacity}-error`}>
            {errors.capacity}
          </p>
        ) : null}
      </div>

      {formNote ? <p className="field__error">{formNote}</p> : null}
      {formError ? <ErrorBanner error={formError} /> : null}

      <button type="submit" className="btn btn--block" disabled={patchEvent.isPending}>
        {patchEvent.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Attendees({ event }: { event: AdminEventDetail }) {
  const remove = useRemoveAttendee(event.id);

  return (
    <section className="stack">
      <h2 className="card__title">
        Attendees <span className="muted tnum">({event.attendees.length})</span>
      </h2>
      {event.attendees.length === 0 ? (
        <EmptyState title="Nobody has RSVP'd" hint="Seats released here go straight back on the board." />
      ) : (
        <ul className="stack">
          {event.attendees.map((attendee) => (
            <li className="card" key={attendee.playerId}>
              <div className="admin-row">
                <span>{attendee.name}</span>
                <span className="text-sm muted">
                  RSVP'd{" "}
                  <time dateTime={toDateTimeAttr(attendee.rsvpAt)}>{formatEventDateTime(attendee.rsvpAt)}</time>
                </span>
              </div>
              <div className="admin-actions admin-actions--split">
                <span className="card__meta admin-mono">{attendee.playerId}</span>
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Remove ${attendee.name} from "${event.title}"? Their seat is released.`))
                      return;
                    remove.mutate({ playerId: attendee.playerId, name: attendee.name });
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminEventDetailPage() {
  const { id = "" } = useParams();
  const event = useAdminEvent(id);
  const setStatus = useSetEventStatus(id);

  if (event.isPending) {
    return (
      <AdminPage title="Event" subtitle="Loading…">
        <div className="stack" role="status" aria-busy="true" aria-label="Loading event">
          <Skeleton width="80%" height={28} />
          <Skeleton height={120} />
          <Skeleton height={320} />
        </div>
      </AdminPage>
    );
  }

  if (event.isError) {
    return (
      <AdminPage title="Event" subtitle="That event could not be loaded.">
        <ErrorBanner error={event.error} onRetry={() => void event.refetch()} />
        <Link to="/admin/events">← All events</Link>
      </AdminPage>
    );
  }

  const detail = event.data;
  const cancelled = detail.status === "cancelled";

  return (
    <AdminPage title={detail.title} subtitle="Edit it, cancel it, or release a seat.">
      <Link to="/admin/events" className="text-sm">
        ← All events
      </Link>

      <section className="card">
        <div className="stack">
          <p>
            <time dateTime={toDateTimeAttr(detail.startsAt)}>{formatEventDateTimeLong(detail.startsAt)}</time>{" "}
            <span className="muted">(your local time)</span>
          </p>
          <p className="muted">{detail.location}</p>
          <p className="card__meta">
            <span className="badge">{gameTypeLabel(detail.gameType)}</span> Hosted by {detail.organizerName}{" "}
            <span className="admin-mono">{detail.organizerId}</span>
          </p>
          <div className="card__row">
            <SeatChip
              seatsLeft={detail.seatsLeft}
              capacity={detail.capacity}
              isFull={detail.isFull}
              status={detail.status}
            />
            <span className="text-sm muted">
              Created <time dateTime={toDateTimeAttr(detail.createdAt)}>{formatEventDateTime(detail.createdAt)}</time>
            </span>
          </div>
          {cancelled && detail.cancelledAt ? (
            <p className="text-sm muted">
              Cancelled{" "}
              <time dateTime={toDateTimeAttr(detail.cancelledAt)}>{formatEventDateTime(detail.cancelledAt)}</time>.
              It is hidden from the board and refuses new RSVPs; the list below is kept.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={cancelled ? "btn btn--block btn--secondary" : "btn btn--block btn--danger"}
          disabled={setStatus.isPending}
          aria-busy={setStatus.isPending}
          onClick={() => {
            if (cancelled) {
              setStatus.mutate("restore");
              return;
            }
            if (
              !window.confirm(
                `Cancel "${detail.title}"? It disappears from the board and nobody new can RSVP. Existing RSVPs are kept and can be restored.`,
              )
            )
              return;
            setStatus.mutate("cancel");
          }}
        >
          {setStatus.isPending ? "Working…" : cancelled ? "Restore event" : "Cancel event"}
        </button>
      </section>

      <EditForm event={detail} />
      <Attendees event={detail} />
    </AdminPage>
  );
}

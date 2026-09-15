/**
 * The organizer side: post a table, then see who's coming.
 *
 * Validation runs twice on purpose. The shared zod schema
 * (`shared/schemas.ts`) runs here so a bad capacity is caught without a round
 * trip, and the *server* runs the same schema and stays the authority — when
 * it answers 400 we map its `details[{path,message}]` straight onto the same
 * fields, so both paths look identical to the user.
 */

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import type { GameType } from "../../shared/game-types";
import { GAME_TYPES, GAME_TYPE_LABELS, gameTypeLabel } from "../../shared/game-types";
import {
  CAPACITY_MAX,
  CAPACITY_MIN,
  LOCATION_MAX,
  TITLE_MAX,
  createEventSchema,
} from "../../shared/schemas";
import { ApiError } from "../api/client";
import { useCreateEvent, useHostedEvents } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { SeatChip } from "../components/SeatChip";
import { EventListSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { defaultLocalInputValue, formatEventDateTime, localInputToIso, toDateTimeAttr } from "../lib/datetime";

type FieldErrors = Partial<Record<"title" | "gameType" | "startsAt" | "location" | "capacity", string>>;

const FIELDS = new Set(["title", "gameType", "startsAt", "location", "capacity"]);

function asFieldKey(path: string): keyof FieldErrors | null {
  const head = path.split(".")[0] ?? "";
  return FIELDS.has(head) ? (head as keyof FieldErrors) : null;
}

function NewEventForm() {
  const toast = useToast();
  const createEvent = useCreateEvent();
  const ids = {
    title: useId(),
    gameType: useId(),
    startsAt: useId(),
    location: useId(),
    capacity: useId(),
  };

  const [title, setTitle] = useState("");
  const [gameType, setGameType] = useState<GameType>("magic_draft");
  const [startsAtLocal, setStartsAtLocal] = useState(() => defaultLocalInputValue(48));
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("8");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const startsAt = localInputToIso(startsAtLocal);
    const parsed = createEventSchema(new Date()).safeParse({
      title,
      gameType,
      startsAt: startsAt ?? "",
      location,
      capacity: capacity.trim() === "" ? Number.NaN : Number(capacity),
    });

    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = asFieldKey(String(issue.path[0] ?? ""));
        if (key && next[key] === undefined) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    createEvent.mutate(parsed.data, {
      onSuccess: (created) => {
        toast.show(`"${created.title}" is live.`);
        setTitle("");
        setLocation("");
        setCapacity("8");
        setStartsAtLocal(defaultLocalInputValue(48));
      },
      onError: (error) => {
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
      <h2 className="card__title">Post an event</h2>

      <div className="field">
        <label className="field__label" htmlFor={ids.title}>
          Title
        </label>
        <input
          id={ids.title}
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={TITLE_MAX}
          placeholder="Friday Night Draft"
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
          onChange={(event) => setGameType(event.target.value as GameType)}
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
          onChange={(event) => setStartsAtLocal(event.target.value)}
          aria-invalid={errors.startsAt !== undefined}
          aria-describedby={describedBy("startsAt", ids.startsAt)}
        />
        <p className="text-sm muted">Your local time; stored and shown to players in theirs.</p>
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
          onChange={(event) => setLocation(event.target.value)}
          maxLength={LOCATION_MAX}
          placeholder="Cardboard Castle, 4th & Pine"
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
          onChange={(event) => setCapacity(event.target.value)}
          aria-invalid={errors.capacity !== undefined}
          aria-describedby={describedBy("capacity", ids.capacity)}
        />
        {errors.capacity ? (
          <p className="field__error" id={`${ids.capacity}-error`}>
            {errors.capacity}
          </p>
        ) : null}
      </div>

      {formError ? <ErrorBanner error={formError} /> : null}

      <button type="submit" className="btn btn--block" disabled={createEvent.isPending}>
        {createEvent.isPending ? "Posting…" : "Post event"}
      </button>
    </form>
  );
}

function HostedEvents() {
  const hosted = useHostedEvents();

  if (hosted.isPending) return <EventListSkeleton label="Loading your events" />;
  if (hosted.isError) return <ErrorBanner error={hosted.error} onRetry={() => void hosted.refetch()} />;
  if ((hosted.data?.length ?? 0) === 0) {
    return <EmptyState title="You haven't posted an event yet" hint="Use the form above to put a table on the board." />;
  }

  return (
    <ul className="stack" aria-busy={hosted.isFetching}>
      {hosted.data?.map((event) => (
        <li key={event.id}>
          <article className="card">
            <Link className="card__link" to={`/organize/events/${event.id}`}>
              <span className="card__title">{event.title}</span>
              <span className="card__meta">
                <time dateTime={toDateTimeAttr(event.startsAt)}>{formatEventDateTime(event.startsAt)}</time>
                {" · "}
                {event.location}
              </span>
              <span className="card__meta">
                <span className="badge">{gameTypeLabel(event.gameType)}</span>
              </span>
            </Link>
            <div className="card__row">
              <SeatChip seatsLeft={event.seatsLeft} capacity={event.capacity} isFull={event.isFull} />
              <Link className="btn btn--sm btn--secondary" to={`/organize/events/${event.id}`}>
                {event.attendeeCount === 1 ? "1 attendee" : `${event.attendeeCount} attendees`}
              </Link>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

export function OrganizerPage() {
  return (
    <div className="stack stack--loose">
      <div>
        <h1 className="page-title">Organize</h1>
        <p className="page-subtitle">Post a table and keep an eye on the door list.</p>
      </div>
      <NewEventForm />
      <div className="stack">
        <h2 className="card__title">Your events</h2>
        <HostedEvents />
      </div>
    </div>
  );
}

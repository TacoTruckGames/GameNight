/**
 * The organizer side: post a table, then see who's coming.
 *
 * Validation runs twice on purpose. The shared zod schema
 * (`shared/schemas.ts`) runs here so a bad capacity is caught without a round
 * trip, and the *server* runs the same schema and stays the authority — when
 * it answers 400 we map its `details[{path,message}]` straight onto the same
 * fields, so both paths look identical to the user.
 */

import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GameType } from "../../shared/game-types";
import { GAME_TYPES, GAME_TYPE_LABELS } from "../../shared/game-types";
import {
  CAPACITY_MAX,
  CAPACITY_MIN,
  DESCRIPTION_MAX,
  LOCATION_MAX,
  TITLE_MAX,
  createEventSchema,
} from "../../shared/schemas";
import { ApiError } from "../api/client";
import { useCreateEvent, useHostedEvents } from "../api/hooks";
import { AgendaViewSwitch, DEFAULT_AGENDA_VIEW, type AgendaView } from "../components/AgendaViewSwitch";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { HostedEventCard } from "../components/HostedEventCard";
import { PlaceCombobox } from "../components/PlaceCombobox";
import { DayGroupedList } from "../components/DayGroupedList";
import { EventListSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { WeekAgenda, weekWindow } from "../components/WeekAgenda";
import { dayKey, groupByDay, shiftDays, startOfWeek, type DayKey } from "../lib/calendar";
import { defaultEventStartValue, localInputToIso } from "../lib/datetime";

type FieldErrors = Partial<
  Record<"title" | "gameType" | "startsAt" | "location" | "placeId" | "description" | "capacity", string>
>;

const FIELDS = new Set(["title", "gameType", "startsAt", "location", "placeId", "description", "capacity"]);

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
    description: useId(),
    capacity: useId(),
  };

  const [title, setTitle] = useState("");
  const [gameType, setGameType] = useState<GameType>("card");
  const [startsAtLocal, setStartsAtLocal] = useState(() => defaultEventStartValue(48));
  const [location, setLocation] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [placeSession, setPlaceSession] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("8");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  /**
   * Said once, after a post whose venue the server could not confirm. Not a
   * toast: the event *is* live, so this is a standing correction to what the
   * organizer thought they filed, and it should still be there when they look
   * back at the form.
   */
  const [placeNote, setPlaceNote] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setPlaceNote(null);

    const startsAt = localInputToIso(startsAtLocal);
    const parsed = createEventSchema(new Date()).safeParse({
      title,
      gameType,
      startsAt: startsAt ?? "",
      location,
      ...(placeId !== null ? { placeId } : {}),
      ...(placeSession !== null ? { placeSessionToken: placeSession } : {}),
      // Always sent, blank included: the schema is the one place that decides
      // what an empty description means (nothing at all).
      description,
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
        // A venue we asked about and did not get back means the lookup failed —
        // Google down, over budget, or the id gone stale. The post succeeded
        // anyway, on purpose, so say what happened instead of pretending.
        if (placeId !== null && created.place === null) {
          setPlaceNote("Posted. We couldn't confirm that venue just now, so the address is saved exactly as you typed it.");
        }
        setTitle("");
        setLocation("");
        setDescription("");
        setPlaceId(null);
        setPlaceSession(null); // the billing session ends with the write it paid for
        setCapacity("8");
        setStartsAtLocal(defaultEventStartValue(48));
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

  /**
   * An error outlives the mistake it describes unless editing the field retires
   * it — "Title is required" under a filled title is a lie, and the red ring
   * fights the focus ring while the user types the fix. Submit still decides:
   * this only forgets, it never re-validates.
   */
  function clearError(field: keyof FieldErrors) {
    setErrors((prev) => {
      if (prev[field] === undefined) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
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
          onChange={(event) => {
            setTitle(event.target.value);
            clearError("title");
          }}
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
          onChange={(event) => {
            setGameType(event.target.value as GameType);
            clearError("gameType");
          }}
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
          onChange={(event) => {
            setStartsAtLocal(event.target.value);
            clearError("startsAt");
          }}
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
        <PlaceCombobox
          id={ids.location}
          value={location}
          onValueChange={(next) => {
            setLocation(next);
            clearError("location");
          }}
          placeId={placeId}
          onPlaceIdChange={(next) => {
            setPlaceId(next);
            clearError("placeId");
          }}
          sessionToken={placeSession}
          onSessionTokenChange={setPlaceSession}
          maxLength={LOCATION_MAX}
          placeholder="Cardboard Castle, 4th & Pine"
          invalid={errors.location !== undefined}
          describedBy={describedBy("location", ids.location)}
        />
        {errors.location ? (
          <p className="field__error" id={`${ids.location}-error`}>
            {errors.location}
          </p>
        ) : null}
        {errors.placeId ? <p className="field__error">{errors.placeId}</p> : null}
        {placeNote ? <p className="field__note">{placeNote}</p> : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.description}>
          Description
        </label>
        <textarea
          id={ids.description}
          className="input"
          rows={4}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            clearError("description");
          }}
          maxLength={DESCRIPTION_MAX}
          placeholder="Bring a deck if you have one — we have spares. Park behind the shop."
          aria-invalid={errors.description !== undefined}
          aria-describedby={describedBy("description", ids.description)}
        />
        <p className="text-sm muted">Optional. What to bring, what you'll play, how to find the table.</p>
        {errors.description ? (
          <p className="field__error" id={`${ids.description}-error`}>
            {errors.description}
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
          onChange={(event) => {
            setCapacity(event.target.value);
            clearError("capacity");
          }}
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
  const [view, setView] = useState<AgendaView>(DEFAULT_AGENDA_VIEW);
  const [weekStart, setWeekStart] = useState<DayKey>(() => startOfWeek(dayKey(new Date())!));

  // Week view asks for exactly the seven days on screen; list view asks for
  // nothing and keeps the endpoint's upcoming-only default.
  const window = useMemo(() => (view === "week" ? weekWindow(weekStart) : undefined), [view, weekStart]);
  const hosted = useHostedEvents(window);

  // Same day headings as the board and My RSVP; `data` is a stable reference
  // between renders, so the memo actually holds.
  const events = hosted.data;
  const groups = useMemo(() => groupByDay(events ?? []), [events]);

  const thisWeek = startOfWeek(dayKey(new Date())!);
  const showWeek = (next: DayKey) => setWeekStart(next);

  // No second unwindowed query to tell an empty week from an empty account: a
  // window cannot know more than the window, and the "never posted" copy is one
  // tap away in list view.
  const emptyWeek = (
    <EmptyState
      title={weekStart === thisWeek ? "Nothing scheduled this week" : "Nothing scheduled that week"}
      hint="Post an event above."
      action={
        <>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => showWeek(shiftDays(weekStart, -7))}
          >
            Previous week
          </button>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => showWeek(shiftDays(weekStart, 7))}
          >
            Next week
          </button>
        </>
      }
    />
  );

  // A fragment, not a wrapper: the switch and the list are siblings of the
  // "Your events" heading inside the section's own `.stack`, which already
  // spaces them.
  return (
    <>
      <AgendaViewSwitch value={view} onChange={setView} />
      {/* List-only placeholder check — it stops a windowed week's rows leaking
          into the unwindowed list for one fetch. */}
      {hosted.isPending || (view === "list" && hosted.isPlaceholderData) ? (
        <EventListSkeleton label="Loading your events" />
      ) : hosted.isError ? (
        <ErrorBanner error={hosted.error} onRetry={() => void hosted.refetch()} />
      ) : view === "list" && (hosted.data?.length ?? 0) === 0 ? (
        <EmptyState title="You haven't posted an event yet" hint="Use the form above to put a table on the board." />
      ) : view === "week" ? (
        <WeekAgenda
          events={events ?? []}
          weekStart={weekStart}
          onWeekChange={showWeek}
          busy={hosted.isFetching}
          loading={hosted.isPlaceholderData}
          emptyWeek={emptyWeek}
        >
          {(event) => <HostedEventCard event={event} />}
        </WeekAgenda>
      ) : (
        <DayGroupedList groups={groups} busy={hosted.isFetching}>
          {(event) => <HostedEventCard event={event} />}
        </DayGroupedList>
      )}
    </>
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

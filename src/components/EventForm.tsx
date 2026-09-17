/**
 * Posting an event and editing one are the same form.
 *
 * They ask for the same seven things, validate them against the same schema and
 * report failures the same way, so they are one component with two submit paths
 * rather than two forms that would drift the moment a field is added. What
 * differs is what "submit" means: a create sends everything and clears itself
 * for the next table; an edit sends **only what changed** and closes.
 *
 * Validation runs twice on purpose. The shared zod schema (`shared/schemas.ts`)
 * runs here so a bad capacity is caught without a round trip, and the *server*
 * runs the same schema and stays the authority — when it answers 400 we map its
 * `details[{path,message}]` straight onto the same fields, so both paths look
 * identical to the user.
 */

import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { EventDetail } from "../../shared/api-types";
import type { GameType } from "../../shared/game-types";
import { GAME_TYPES, GAME_TYPE_LABELS } from "../../shared/game-types";
import {
  CAPACITY_MAX,
  CAPACITY_MIN,
  DESCRIPTION_MAX,
  LOCATION_MAX,
  TITLE_MAX,
  createEventSchema,
  type EventPatch,
} from "../../shared/schemas";
import { ApiError } from "../api/client";
import { useCreateEvent, useUpdateEvent } from "../api/hooks";
import { ErrorBanner } from "./ErrorBanner";
import { PlaceCombobox } from "./PlaceCombobox";
import { useToast } from "./Toast";
import { defaultEventStartValue, isoToLocalInput, localInputToIso } from "../lib/datetime";

type FieldErrors = Partial<
  Record<"title" | "gameType" | "startsAt" | "location" | "placeId" | "description" | "capacity", string>
>;

const FIELDS = new Set(["title", "gameType", "startsAt", "location", "placeId", "description", "capacity"]);

function asFieldKey(path: string): keyof FieldErrors | null {
  const head = path.split(".")[0] ?? "";
  return FIELDS.has(head) ? (head as keyof FieldErrors) : null;
}

/** Server `details` → one message per field, first one wins. */
function fieldErrorsFrom(issues: readonly { path: string; message: string }[]): FieldErrors {
  const next: FieldErrors = {};
  for (const issue of issues) {
    const key = asFieldKey(issue.path);
    if (key && next[key] === undefined) next[key] = issue.message;
  }
  return next;
}

export function EventForm({ event, onDone }: { event?: EventDetail; onDone?: () => void }) {
  const editing = event !== undefined;
  const toast = useToast();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent(event?.id ?? "");
  const ids = {
    title: useId(),
    gameType: useId(),
    startsAt: useId(),
    location: useId(),
    description: useId(),
    capacity: useId(),
  };

  // The event's own values are the initial state when editing, and the same
  // `useState` initialiser is the create defaults when not — so the form never
  // needs an effect to sync itself with a prop.
  const [title, setTitle] = useState(event?.title ?? "");
  const [gameType, setGameType] = useState<GameType>(event?.gameType ?? "card");
  const [startsAtLocal, setStartsAtLocal] = useState(() =>
    event ? isoToLocalInput(event.startsAt) : defaultEventStartValue(48),
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [placeId, setPlaceId] = useState<string | null>(event?.place?.id ?? null);
  const [placeSession, setPlaceSession] = useState<string | null>(null);
  const [description, setDescription] = useState(event?.description ?? "");
  const [capacity, setCapacity] = useState(event ? String(event.capacity) : "8");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  /**
   * Said once, after a write whose venue the server could not confirm. Not a
   * toast: the event *is* live, so this is a standing correction to what the
   * organizer thought they filed, and it should still be there when they look
   * back at the form.
   */
  const [placeNote, setPlaceNote] = useState<string | null>(null);

  const pending = createEvent.isPending || updateEvent.isPending;

  /**
   * What the organizer actually changed — nothing else is sent.
   *
   * `startsAt` is compared as the *local input string* rather than by
   * round-tripping to an instant: `datetime-local` has no seconds, so an event
   * stored at 19:00:30 would come back as 19:00 and read as an edit nobody
   * made. Worse, on an event that has already started that phantom edit is a
   * 400 ("Start time must be in the future") for the crime of fixing a typo in
   * the title.
   *
   * `description` and `placeId` are the two that can be *removed*: an emptied
   * textarea or a cleared venue sends an explicit `null`, which is how the
   * schema distinguishes "erase this" from "leave it alone". Blank-and-was-null
   * is not a change at all.
   */
  function changes(): EventPatch {
    if (!event) return {};
    const patch: EventPatch = {};
    if (title.trim() !== event.title) patch.title = title.trim();
    if (gameType !== event.gameType) patch.gameType = gameType;
    if (startsAtLocal !== isoToLocalInput(event.startsAt)) {
      patch.startsAt = localInputToIso(startsAtLocal) ?? "";
    }
    if (location.trim() !== event.location) patch.location = location.trim();
    if (placeId !== (event.place?.id ?? null)) {
      patch.placeId = placeId;
      if (placeId !== null && placeSession !== null) patch.placeSessionToken = placeSession;
    }
    if (description.trim() !== (event.description ?? "")) {
      patch.description = description.trim() === "" ? null : description.trim();
    }
    const nextCapacity = capacity.trim() === "" ? Number.NaN : Number(capacity);
    if (nextCapacity !== event.capacity) patch.capacity = nextCapacity;
    return patch;
  }

  const dirty = editing ? Object.keys(changes()).length > 0 : true;

  function onFieldErrors(error: unknown): boolean {
    if (error instanceof ApiError && error.code === "VALIDATION_FAILED" && error.details) {
      const next = fieldErrorsFrom(error.details);
      if (Object.keys(next).length > 0) {
        setErrors(next);
        return true;
      }
    }
    return false;
  }

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);
    setPlaceNote(null);

    if (editing) return submitEdit();
    return submitCreate();
  }

  function submitEdit() {
    const patch = changes();
    // Pressing Save having changed nothing is not an error and not a request:
    // the schema would answer "Change at least one field", which is true and
    // unhelpful. Close instead — they are done.
    if (Object.keys(patch).length === 0) {
      onDone?.();
      return;
    }

    // The same schema the server runs, minus the fields this edit is not
    // touching. `.partial()` is why an untouched required field is not an error.
    const parsed = createEventSchema(new Date()).partial().safeParse(patch);
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? ""), message: i.message }))));
      return;
    }

    setErrors({});
    updateEvent.mutate(parsed.data, {
      onSuccess: (updated) => {
        toast.show(`"${updated.title}" updated.`);
        setPlaceSession(null); // the billing session ends with the write it paid for
        onDone?.();
      },
      onError: (error) => {
        if (!onFieldErrors(error)) setFormError(error);
      },
    });
  }

  function submitCreate() {
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
      setErrors(fieldErrorsFrom(parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? ""), message: i.message }))));
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
        setPlaceSession(null);
        setCapacity("8");
        setStartsAtLocal(defaultEventStartValue(48));
      },
      onError: (error) => {
        if (!onFieldErrors(error)) setFormError(error);
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
      <h2 className="card__title">{editing ? "Edit event" : "Post an event"}</h2>

      <div className="field">
        <label className="field__label" htmlFor={ids.title}>
          Title
        </label>
        <input
          id={ids.title}
          className="input"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
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
          onChange={(e) => {
            setGameType(e.target.value as GameType);
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
          onChange={(e) => {
            setStartsAtLocal(e.target.value);
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
          onChange={(e) => {
            setDescription(e.target.value);
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
          onChange={(e) => {
            setCapacity(e.target.value);
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

      {editing ? (
        // Two buttons, and Cancel is the secondary one: an edit is a thing you
        // are in the middle of, so there has to be a way out that is not the
        // browser's Back.
        <div className="form-actions">
          <button type="submit" className="btn" disabled={pending || !dirty}>
            {updateEvent.isPending ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => onDone?.()} disabled={pending}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="submit" className="btn btn--block" disabled={pending}>
          {createEvent.isPending ? "Posting…" : "Post event"}
        </button>
      )}
    </form>
  );
}

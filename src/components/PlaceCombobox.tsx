/**
 * The location field, in two shapes.
 *
 * **Without a maps key it is not a combobox at all.** `PlaceCombobox` returns
 * today's `<input className="input">` verbatim — no `role`, no listbox, no live
 * region, no extra nodes. That matters more than it looks: a reviewer cloning
 * this repo has no key, so the plain input is the *normal* build, and an
 * accessibility tree that grew a combobox announcing an empty list would be a
 * regression paid for by a feature that is switched off.
 *
 * With a key it is an ARIA 1.2 combobox over `GET /api/places/suggest`. Three
 * things about it are deliberate:
 *
 *   - **300 ms debounce, 3-character minimum.** This is the cost control for
 *     the whole feature. Google bills the first 12 autocomplete requests of a
 *     session whatever happens, so break-even on a session token is ~4.2
 *     requests; the debounce is what keeps a real session near 3. Shortening it
 *     to feel snappier is spending money, not polish.
 *   - **Picking a suggestion fills the visible text but never locks it, and
 *     editing the text keeps the link.** "Cardboard Castle, back room" is the
 *     whole point of keeping `location` a separate string: Google knows the
 *     building, the organizer knows the room. If a keystroke dropped the link,
 *     the single most likely edit — appending the room to the name you just
 *     picked — would silently throw the map pin away. The link is dropped only
 *     by an explicit act: emptying the field, choosing "Use what I typed", or
 *     pressing Remove. While one is held, the field says so.
 *   - **"Use what I typed" is always the last option.** A venue that is not in
 *     Google's index is an ordinary case, not a dead end, and the escape hatch
 *     has to be visible before the user starts wondering whether the form is
 *     going to let them through.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { LOCATION_MAX } from "../../shared/schemas";
import { PLACE_QUERY_MIN, useMapsConfig, usePlaceSuggestions, type PlaceSuggestion } from "../api/hooks";

/** One pause in typing, not one request per keystroke. See the note above. */
const DEBOUNCE_MS = 300;

/**
 * Room left for the fixed bottom tab bar (44px plus its padding) and a little
 * air. Google returns up to five predictions, which with the escape hatch is a
 * list taller than the space under a field low on a 390×844 phone — so the list
 * is capped to what actually fits and scrolls inside itself, rather than
 * sliding its last option (the escape hatch, the one someone hunting for a way
 * out needs most) under the tab bar.
 */
const TAB_BAR_GUTTER = 76;
const LIST_MIN = 160;
const LIST_MAX = 320;

export interface PlaceComboboxProps {
  /** The free-text label — `events.location`, and always what a human reads. */
  value: string;
  onValueChange: (value: string) => void;
  /**
   * The picked Google place id, or `null` for free text. Only ever an id: the
   * address and coordinates are resolved server-side, so the client has nothing
   * else worth holding.
   */
  placeId: string | null;
  onPlaceIdChange: (placeId: string | null) => void;
  /**
   * Google's autocomplete session token, owned by the parent form so it can be
   * put in the submit body and thrown away after a successful write. `null`
   * means "not started"; this component mints one on the first keystroke.
   */
  sessionToken: string | null;
  onSessionTokenChange: (token: string | null) => void;
  id: string;
  maxLength: number;
  placeholder?: string;
  invalid: boolean;
  describedBy: string | undefined;
}

export function PlaceCombobox(props: PlaceComboboxProps) {
  const config = useMapsConfig({ enabled: true });
  // Not a variant — an early return. See the file comment.
  if (!config.suggest) return <PlainLocationInput {...props} />;
  return <SuggestingCombobox {...props} />;
}

/** Byte-for-byte the input this field was before the feature existed. */
function PlainLocationInput({
  value,
  onValueChange,
  id,
  maxLength,
  placeholder,
  invalid,
  describedBy,
}: PlaceComboboxProps) {
  return (
    <input
      id={id}
      className="input"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-invalid={invalid}
      aria-describedby={describedBy}
    />
  );
}

/** A suggestion, or the escape hatch. Both are options in the same listbox. */
type Option = { kind: "place"; suggestion: PlaceSuggestion } | { kind: "typed" };

function SuggestingCombobox({
  value,
  onValueChange,
  placeId,
  onPlaceIdChange,
  sessionToken,
  onSessionTokenChange,
  id,
  maxLength,
  placeholder,
  invalid,
  describedBy,
}: PlaceComboboxProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [maxHeight, setMaxHeight] = useState(LIST_MAX);
  const [open, setOpen] = useState(false);
  /** -1 means "nothing highlighted" — the state the list always opens in. */
  const [active, setActive] = useState(-1);
  const [debounced, setDebounced] = useState("");
  // The token has to survive the render that creates it, before the parent's
  // state update lands, or the first suggest request would go out without one.
  const tokenRef = useRef(sessionToken);
  tokenRef.current = sessionToken;

  const trimmed = value.trim();
  const searchable = trimmed.length >= PLACE_QUERY_MIN;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const suggestions = usePlaceSuggestions(debounced, sessionToken ?? "", open && searchable);
  const places = suggestions.data ?? [];

  // The escape hatch is the last option, always — including when Google found
  // nothing, which is exactly when it is needed most.
  const options: Option[] = [...places.map((suggestion) => ({ kind: "place" as const, suggestion })), { kind: "typed" }];
  const listOpen = open && searchable;
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Measured, not guessed: the field sits at a different height in the two forms
  // and on every phone.
  useLayoutEffect(() => {
    if (!listOpen) return;
    const input = inputRef.current;
    if (!input) return;
    const below = window.innerHeight - input.getBoundingClientRect().bottom - TAB_BAR_GUTTER;
    setMaxHeight(Math.round(Math.min(LIST_MAX, Math.max(LIST_MIN, below))));
  }, [listOpen, places.length]);

  // A capped list scrolls, and a keyboard user arrowing to option five must not
  // be arrowing at something they cannot see.
  useEffect(() => {
    if (!listOpen || active < 0) return;
    // `nearest` scrolls the list and nothing else, so the page never jumps.
    listRef.current?.querySelector(`[id="${listId}-option-${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [listOpen, active, listId]);

  function startTyping(next: string) {
    onValueChange(next);
    setActive(-1);
    setOpen(true);
    // The link deliberately SURVIVES editing: the label carries the room, the
    // link carries the building. Emptying the field is the one edit that means
    // "forget the venue" — see the clause below.
    if (next.trim() === "") {
      // A cleared field ends the session: the next search is a new one. It also
      // drops the link — there is no label left for it to belong to.
      if (placeId !== null) onPlaceIdChange(null);
      onSessionTokenChange(null);
      setOpen(false);
      return;
    }
    if (tokenRef.current === null) {
      const token = crypto.randomUUID();
      tokenRef.current = token;
      onSessionTokenChange(token);
    }
  }

  function choose(option: Option) {
    if (option.kind === "place") {
      onValueChange(labelFor(option.suggestion, maxLength));
      onPlaceIdChange(option.suggestion.placeId);
    } else {
      // Declining the link is a decision, so it clears any previous pick.
      onPlaceIdChange(null);
    }
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // Closes; never clears. Escape that ate your typing is a bug, not a feature.
      if (listOpen) event.preventDefault();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!searchable) return;
      event.preventDefault();
      if (!listOpen) {
        setOpen(true);
        setActive(event.key === "ArrowDown" ? 0 : options.length - 1);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      const count = options.length;
      setActive((current) => {
        if (current === -1) return step === 1 ? 0 : count - 1;
        return (current + step + count) % count; // wraps at both ends
      });
      return;
    }
    if (event.key === "Enter" && listOpen && active >= 0) {
      // Without this the Enter that picks a venue also posts the event.
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
    }
  }

  return (
    <div className="combo">
      <input
        ref={inputRef}
        id={id}
        className="input"
        value={value}
        onChange={(event) => startTyping(event.target.value)}
        onKeyDown={onKeyDown}
        // Deliberately no `onFocus` opener: clicking back into an already-filled
        // field would then fire a billed lookup for text the user never changed.
        // Arrow-down reopens the list for anyone who wants it.
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
      />

      {listOpen ? (
        <ul
          ref={listRef}
          className="combo__list"
          id={listId}
          role="listbox"
          aria-label="Venue suggestions"
          style={{ maxHeight }}
        >
          {options.map((option, index) => (
            <li
              key={option.kind === "place" ? option.suggestion.placeId : "typed"}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={index === active ? "combo__option combo__option--active" : "combo__option"}
              // Pointer-down, not click: a click fires after blur, and blur has
              // already closed the list out from under the finger.
              onPointerDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {option.kind === "place" ? (
                <>
                  <span className="combo__primary">{option.suggestion.primaryText}</span>
                  {option.suggestion.secondaryText ? (
                    <span className="combo__secondary">{option.suggestion.secondaryText}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="combo__primary">Use what I typed</span>
                  <span className="combo__secondary">{trimmed}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="visually-hidden" aria-live="polite">
        {liveMessage(listOpen, suggestions.isFetching, places.length)}
      </p>
    </div>
  );
}

/**
 * What the visible label becomes when a suggestion is picked: name and street,
 * which is what a person reading a card wants. The *canonical* address is
 * uncapped and lives in `place.address`, so truncating here loses nothing —
 * but an over-long label would fail validation on submit, so fall back to the
 * name alone rather than to a sentence cut mid-word.
 */
export function labelFor(suggestion: PlaceSuggestion, maxLength = LOCATION_MAX): string {
  const joined = suggestion.secondaryText
    ? `${suggestion.primaryText}, ${suggestion.secondaryText}`
    : suggestion.primaryText;
  if (joined.length <= maxLength) return joined;
  if (suggestion.primaryText.length <= maxLength) return suggestion.primaryText;
  return suggestion.primaryText.slice(0, maxLength);
}

function liveMessage(open: boolean, fetching: boolean, count: number): string {
  if (!open) return "";
  if (fetching) return "Searching for venues";
  if (count === 0) return "No venue matches. Use what you typed.";
  return `${count} venue ${count === 1 ? "suggestion" : "suggestions"}. Use the arrow keys to review.`;
}

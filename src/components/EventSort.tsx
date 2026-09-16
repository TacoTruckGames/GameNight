/**
 * The list view's sort control.
 *
 * A segmented control rather than chips, matching the View switch directly
 * above it: both are "pick exactly one of two", and two controls that ask the
 * same kind of question should not be two different shapes.
 *
 * Exclusive, so tapping the active option does nothing — "no order" is not a
 * thing a list can be. Calendar view does not render this at all: a month grid
 * is chronological by construction.
 */

import { useId } from "react";
import { EVENT_SORTS, EVENT_SORT_LABELS, type EventSort } from "../../shared/event-sort";

export function EventSortControl({ value, onChange }: { value: EventSort; onChange: (next: EventSort) => void }) {
  const labelId = useId();
  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        Sort
      </span>
      <div className="segmented" role="group" aria-labelledby={labelId}>
        {EVENT_SORTS.map((sort) => (
          <button
            key={sort}
            type="button"
            className="segmented__option"
            aria-pressed={value === sort}
            onClick={() => onChange(sort)}
          >
            {EVENT_SORT_LABELS[sort]}
          </button>
        ))}
      </div>
    </div>
  );
}

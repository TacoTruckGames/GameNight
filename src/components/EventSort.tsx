/**
 * The board's sort control: the same chips as the game-type filter, because
 * the two rows sit together and a select here would be the only popover on the
 * page.
 *
 * Unlike the filter chips these are exclusive — one is always pressed, and
 * tapping the active one does nothing, since "no order" is not a thing a list
 * can be.
 */

import { useId } from "react";
import { EVENT_SORTS, EVENT_SORT_LABELS, type EventSort } from "../../shared/event-sort";

export function EventSortControl({ value, onChange }: { value: EventSort; onChange: (next: EventSort) => void }) {
  const labelId = useId();
  return (
    <div className="filter-group">
      <span className="filter-group__label" id={labelId}>
        Sort
      </span>
      <div className="chip-row" role="group" aria-labelledby={labelId}>
        {EVENT_SORTS.map((sort) => (
          <button
            key={sort}
            type="button"
            className="chip"
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

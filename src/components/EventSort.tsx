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

import { EVENT_SORTS, EVENT_SORT_LABELS, type EventSort } from "../../shared/event-sort";
import { SegmentedControl } from "./SegmentedControl";

export function EventSortControl({ value, onChange }: { value: EventSort; onChange: (next: EventSort) => void }) {
  return (
    <SegmentedControl label="Sort" options={EVENT_SORTS} labels={EVENT_SORT_LABELS} value={value} onChange={onChange} />
  );
}

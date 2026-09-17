/**
 * Week or list — the two readings of a personal agenda.
 *
 * Week leads, and is the default, because of the question these two pages are
 * opened with: not "what's next" (a list answers that) but "what's my week —
 * am I double-booked on Saturday?", which a list makes you work out by reading
 * every date. The board needed a whole month grid to hold ~50 events; one
 * person's week fits in seven cells, so the strip costs a single row and the
 * day pane below it is the same day-grouped list as ever.
 *
 * List stays one tap away and unchanged, and it is the unwindowed view: the
 * upcoming feed, exactly as it was before the strip existed.
 *
 * The constants live here rather than in `shared/` for the same reason the
 * board's do: the worker never sees the view. It is a client-side rendering
 * choice over rows the API has already returned.
 */

import { SegmentedControl } from "./SegmentedControl";

export const AGENDA_VIEWS = ["week", "list"] as const;
export type AgendaView = (typeof AGENDA_VIEWS)[number];
export const DEFAULT_AGENDA_VIEW: AgendaView = "week";
export const AGENDA_VIEW_LABELS: Record<AgendaView, string> = { week: "Week", list: "List" };

export function AgendaViewSwitch({ value, onChange }: { value: AgendaView; onChange: (next: AgendaView) => void }) {
  return (
    <SegmentedControl
      label="View"
      options={AGENDA_VIEWS}
      labels={AGENDA_VIEW_LABELS}
      value={value}
      onChange={onChange}
    />
  );
}

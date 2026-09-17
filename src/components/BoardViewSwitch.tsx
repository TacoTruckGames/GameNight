/**
 * Calendar or list — the board's two readings of the same query result.
 *
 * Calendar leads, and is the default: with ~50 events the month grid answers
 * "what is on this Saturday" at a glance, while a flat list answers only "what
 * is next". The list is still one tap away for anyone who wants the feed.
 *
 * The constants live here rather than in `shared/` because the worker never
 * sees the view: it is a client-side rendering choice over rows the API has
 * already returned, so nothing on the server has an opinion about it.
 *
 * Rendered as a segmented control — the same shape as the identity picker's
 * Player/Organizer switch, because it asks the same kind of question: two
 * mutually exclusive modes, one of which is always on.
 */

import { SegmentedControl } from "./SegmentedControl";

export const BOARD_VIEWS = ["calendar", "list"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = "calendar";
export const BOARD_VIEW_LABELS: Record<BoardView, string> = { calendar: "Calendar", list: "List" };

export function BoardViewSwitch({ value, onChange }: { value: BoardView; onChange: (next: BoardView) => void }) {
  return (
    <SegmentedControl label="View" options={BOARD_VIEWS} labels={BOARD_VIEW_LABELS} value={value} onChange={onChange} />
  );
}

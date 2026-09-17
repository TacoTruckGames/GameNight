/**
 * Week, month or list — the board's three readings of the same query result.
 *
 * Week leads, and is the default. "What can I get to in the next few days" is
 * the question someone opens a board with, and a week of seven cells answers it
 * without the scrolling a month of thirty demands on a phone. Month is a step
 * out for planning further ahead; list is the plain feed, and the only view
 * that sorts by anything other than the clock.
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

export const BOARD_VIEWS = ["week", "month", "list"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = "week";
export const BOARD_VIEW_LABELS: Record<BoardView, string> = { week: "Week", month: "Month", list: "List" };

export function BoardViewSwitch({ value, onChange }: { value: BoardView; onChange: (next: BoardView) => void }) {
  return (
    <SegmentedControl label="View" options={BOARD_VIEWS} labels={BOARD_VIEW_LABELS} value={value} onChange={onChange} />
  );
}

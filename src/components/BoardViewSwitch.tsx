/**
 * List or calendar — the board's two readings of the same query result.
 *
 * The constants live here rather than in `shared/` because the worker never
 * sees the view: it is a client-side rendering choice over rows the API has
 * already returned, so nothing on the server has an opinion about it.
 *
 * Same chips as the sort control, and exclusive for the same reason — tapping
 * the active one does nothing, since "no view" is not a thing a board can be.
 */

import { useId } from "react";

export const BOARD_VIEWS = ["list", "calendar"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = "list";
export const BOARD_VIEW_LABELS: Record<BoardView, string> = { list: "List", calendar: "Calendar" };

export function BoardViewSwitch({ value, onChange }: { value: BoardView; onChange: (next: BoardView) => void }) {
  const labelId = useId();
  return (
    <div className="filter-group">
      <span className="filter-group__label" id={labelId}>
        View
      </span>
      <div className="chip-row" role="group" aria-labelledby={labelId}>
        {BOARD_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className="chip"
            aria-pressed={value === view}
            onClick={() => onChange(view)}
          >
            {BOARD_VIEW_LABELS[view]}
          </button>
        ))}
      </div>
    </div>
  );
}

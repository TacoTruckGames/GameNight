/**
 * Game-type filter as a native `<select>`.
 *
 * It was a chip row, which cost two wrapped rows on a phone and pushed the
 * board itself below the fold. One control that collapses to a single line
 * leaves the first card visible, and the native picker is the one popover worth
 * having: the platform renders it as a bottom sheet on iOS and a full-screen
 * list on Android, so it stays thumb-reachable without any code of ours.
 *
 * `FILTER_GAME_TYPES` omits `board_games` — still a valid tag, just too broad
 * to filter on.
 */

import { useId } from "react";
import { FILTER_GAME_TYPES, GAME_TYPE_LABELS } from "../../shared/game-types";

export function GameTypeFilter({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const selectId = useId();
  return (
    <div className="filter-group">
      <label className="visually-hidden" htmlFor={selectId}>
        Filter by game type
      </label>
      <select
        id={selectId}
        className="select select--auto"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {FILTER_GAME_TYPES.map((gameType) => (
          <option key={gameType} value={gameType}>
            {GAME_TYPE_LABELS[gameType]}
          </option>
        ))}
      </select>
    </div>
  );
}

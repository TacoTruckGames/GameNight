/**
 * Game-type filter as a native `<select>`.
 *
 * It was a chip row, which cost two wrapped rows on a phone and pushed the
 * board itself below the fold. The native picker is the one popover worth
 * having: the platform renders it as a bottom sheet on iOS and a full-screen
 * list on Android, so it stays thumb-reachable without any code of ours.
 *
 * Labelled and full-width like the View and Sort controls below it — the three
 * together read as one stack of settings rather than three loose shapes.
 *
 * Every category is a filter option. "Board games" was once left out for being
 * too broad — but under category-level types every bucket is that broad by
 * design; the filter narrows to a kind of night and `?q=` finds the exact game.
 */

import { useId } from "react";
import { GAME_TYPES, GAME_TYPE_LABELS } from "../../shared/game-types";

export function GameTypeFilter({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const selectId = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={selectId}>
        Game
      </label>
      <select
        id={selectId}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {GAME_TYPES.map((gameType) => (
          <option key={gameType} value={gameType}>
            {GAME_TYPE_LABELS[gameType]}
          </option>
        ))}
      </select>
    </div>
  );
}

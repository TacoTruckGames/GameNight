/**
 * Horizontally scrollable game-type chips — one tap, thumb-reachable, no
 * select popover to fight with on a moving train.
 */

import { FILTER_GAME_TYPES, GAME_TYPE_LABELS } from "../../shared/game-types";

export function GameTypeFilter({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="chip-row" role="group" aria-label="Filter by game type">
      <button
        type="button"
        className="chip"
        aria-pressed={value === ""}
        onClick={() => onChange("")}
      >
        All
      </button>
      {FILTER_GAME_TYPES.map((gameType) => (
        <button
          key={gameType}
          type="button"
          className="chip"
          aria-pressed={value === gameType}
          // Tapping the active chip clears the filter.
          onClick={() => onChange(value === gameType ? "" : gameType)}
        >
          {GAME_TYPE_LABELS[gameType]}
        </button>
      ))}
    </div>
  );
}

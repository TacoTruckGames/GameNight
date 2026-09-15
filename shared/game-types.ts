/**
 * The game types an event can be tagged with.
 *
 * Deliberately a closed enum validated by zod rather than a DB CHECK: adding a
 * type is a one-line change here plus a label, with no migration, and the API
 * rejects unknown values before they ever reach D1.
 */

export const GAME_TYPES = [
  "magic_draft",
  "commander",
  "dnd",
  "board_games",
  "warhammer",
  "other",
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  magic_draft: "Magic: Draft",
  commander: "Commander",
  dnd: "D&D",
  board_games: "Board games",
  warhammer: "Warhammer",
  other: "Other",
};

export function isGameType(value: unknown): value is GameType {
  return typeof value === "string" && (GAME_TYPES as readonly string[]).includes(value);
}

/** Human label for a game type; falls back to the raw value for forward compat. */
export function gameTypeLabel(value: string): string {
  return isGameType(value) ? GAME_TYPE_LABELS[value] : value;
}

/**
 * The game types an event can be tagged with.
 *
 * These are *categories of night*, not games: Card games, Board games, RPG,
 * Miniatures, Other. The specific game — Magic, Pokémon, Pathfinder, Legion —
 * belongs in the title, and the format ("draft", "sealed", "one-shot") beside
 * it, which is what the seed does: "Friday Night Draft", "Commander Pod Night".
 *
 * Why this level and not the game or the format: this is a metro-wide board
 * that a library board-game club and a home D&D group post to alongside the
 * stores, so the buckets have to hold for every organizer. The two products
 * built for exactly this job agree — Tabletop.Events creates "Board Game, Card
 * Game, Miniatures, RPG" by default and Warhorn offers board, card, RPG,
 * miniature, other — while store calendars (Mox, Dreamers Vault) go by
 * franchise and grow a bucket per new TCG, and Wizards' own EventLink goes by
 * Magic format, which is meaningless for everything that is not Magic. The
 * first version of this enum mixed all three levels (a Magic format, a specific
 * RPG, a whole category) and had no home for a Pokémon league or a Pathfinder
 * table. The trade is a coarser filter; `?q=` finds the exact game.
 *
 * Deliberately a closed enum validated by zod rather than a DB CHECK: adding a
 * type is a one-line change here plus a label, with no migration, and the API
 * rejects unknown values before they ever reach D1. A row that somehow carries
 * an old or unknown value renders as `other` (see `toGameType` in the worker)
 * rather than breaking a card.
 */

export const GAME_TYPES = ["card", "board", "rpg", "miniatures", "other"] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  card: "Card games",
  board: "Board games",
  rpg: "RPG",
  miniatures: "Miniatures",
  other: "Other",
};

export function isGameType(value: unknown): value is GameType {
  return typeof value === "string" && (GAME_TYPES as readonly string[]).includes(value);
}

/** Human label for a game type; falls back to the raw value for forward compat. */
export function gameTypeLabel(value: string): string {
  return isGameType(value) ? GAME_TYPE_LABELS[value] : value;
}

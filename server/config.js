export const STARTING_BANKROLL = 10_000;
/** A player may reload back to the starting bankroll once bankroll + chips on tables drops below this. */
export const RELOAD_THRESHOLD = 1_000;

export const ACTION_TIMEOUT_MS = 25_000;
/** Players sitting out this long are stood up and their chips returned to their bankroll. */
export const SIT_OUT_LIMIT_MS = 5 * 60_000;

export const BUY_IN_MIN_BB = 40;
export const BUY_IN_MAX_BB = 100;

/** Cash tables in the lobby. Bots keep (seats - 2) chairs filled and step aside as people sit. */
export const TABLES = [
  { id: 'emerald', name: 'Emerald', maxSeats: 9, smallBlind: 10, bigBlind: 20 },
  { id: 'sapphire', name: 'Sapphire', maxSeats: 6, smallBlind: 25, bigBlind: 50 },
  { id: 'ruby', name: 'Ruby', maxSeats: 9, smallBlind: 50, bigBlind: 100 },
  { id: 'onyx', name: 'Onyx', maxSeats: 6, smallBlind: 50, bigBlind: 100 },
  { id: 'diamond', name: 'Diamond', maxSeats: 9, smallBlind: 100, bigBlind: 200 },
  { id: 'obsidian', name: 'Obsidian', maxSeats: 6, smallBlind: 250, bigBlind: 500 },
];

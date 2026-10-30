/**
 * Split chip contributions into a main pot and side pots.
 *
 * @param {{seat:number, amount:number, live:boolean}[]} contributions
 *   amount = chips the player put in; live = still holding cards (not folded)
 * @returns {{amount:number, eligible:number[]}[]} main pot first
 */
export function splitPots(contributions) {
  const left = contributions.map((c) => ({ ...c }));
  const pots = [];
  for (;;) {
    const liveAmounts = left.filter((c) => c.live && c.amount > 0).map((c) => c.amount);
    if (!liveAmounts.length) break;
    // Every live player still owed money contributes up to this level.
    const level = Math.min(...liveAmounts);
    let amount = 0;
    const eligible = [];
    for (const c of left) {
      if (c.amount <= 0) continue;
      const take = Math.min(c.amount, level);
      amount += take;
      c.amount -= take;
      if (c.live) eligible.push(c.seat);
    }
    const prev = pots[pots.length - 1];
    if (prev && sameSeats(prev.eligible, eligible)) prev.amount += amount;
    else pots.push({ amount, eligible });
  }
  // Dead money above every live player's contribution belongs to the last pot.
  const leftover = left.reduce((sum, c) => sum + c.amount, 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: [] });
  }
  return pots;
}

function sameSeats(a, b) {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

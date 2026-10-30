/**
 * Seat centre points as % of the table area, index 0 = bottom centre, then clockwise
 * (which on screen runs bottom → left → top → right).
 */
export const SEAT_LAYOUTS = {
  9: [[50, 89], [21, 84], [6, 60], [9, 27], [31, 9], [69, 9], [91, 27], [94, 60], [79, 84]],
  6: [[50, 89], [10, 70], [12, 26], [50, 9], [88, 26], [90, 70]],
};

/** On narrow screens seats are pulled in so they don't hang off the edge. */
export function seatPoint(maxSeats, displayIndex, compact = false) {
  const [x, y] = SEAT_LAYOUTS[maxSeats][displayIndex];
  return compact ? [50 + (x - 50) * 0.8, y] : [x, y];
}

/** Point `t` of the way from a seat toward the table centre. */
export function towardCentre([x, y], t) {
  return [x + (50 - x) * t, y + (48 - y) * t];
}

/**
 * Dealer button spot: part way in from the seat, then shifted sideways so it never sits on the bet.
 * `aspect` is the table's width/height, to work in on-screen units.
 */
export function dealerPoint([x, y], aspect) {
  const dx = (50 - x) * aspect;
  const dy = 48 - y;
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  const along = len * 0.24;
  const side = 9;
  return [x + (ux * along - uy * side) / aspect, y + uy * along + ux * side];
}

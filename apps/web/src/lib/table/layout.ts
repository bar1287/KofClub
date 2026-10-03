/**
 * Seat positions around an elliptical table, as percentages of the table
 * area. The viewer's seat (or seat 1 for spectators) is drawn at the
 * bottom centre and the others follow clockwise.
 */
export function seatPosition(
  seat: number,
  anchorSeat: number,
  maxSeats: number,
): { left: number; top: number } {
  const index = (((seat - anchorSeat) % maxSeats) + maxSeats) % maxSeats;
  const angle = Math.PI / 2 + (index * 2 * Math.PI) / maxSeats; // screen coords, y down
  return {
    left: round(50 + 44 * Math.cos(angle)),
    top: round(50 + 42 * Math.sin(angle)),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

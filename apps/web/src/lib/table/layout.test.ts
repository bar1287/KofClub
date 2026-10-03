import { seatPosition } from './layout';

describe('seatPosition', () => {
  it('puts the anchor seat at the bottom centre and rotates clockwise', () => {
    expect(seatPosition(3, 3, 6)).toEqual({ left: 50, top: 92 });
    // Directly opposite the anchor at a 6-max table.
    expect(seatPosition(6, 3, 6)).toEqual({ left: 50, top: 8 });
    // Next seat clockwise goes to the left side of the screen.
    expect(seatPosition(4, 3, 6).left).toBeLessThan(50);
    expect(seatPosition(2, 3, 6).left).toBeGreaterThan(50);
  });
});

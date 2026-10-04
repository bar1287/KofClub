import { describeEvent } from './describe';

const name = (seat: number) => ['', 'alice', 'bob', 'carol'][seat] ?? `Seat ${seat}`;

describe('describeEvent', () => {
  it('describes betting actions with all-in and timeout markers', () => {
    expect(
      describeEvent(
        {
          kind: 'PLAYER_ACTED',
          seat: 2,
          action: 'RAISE',
          added: 290,
          streetBet: 300,
          stack: 0,
          allIn: true,
          pot: 400,
          timeout: false,
        },
        name,
      ),
    ).toBe('bob raises to 300 (all-in).');
    expect(
      describeEvent(
        {
          kind: 'PLAYER_ACTED',
          seat: 1,
          action: 'CALL',
          added: 40,
          streetBet: 50,
          stack: 900,
          allIn: false,
          pot: 120,
          timeout: false,
        },
        name,
      ),
    ).toBe('alice calls 40.');
  });

  it('describes split side pots and hides card-dealing noise', () => {
    expect(
      describeEvent(
        {
          kind: 'POT_AWARDED',
          potIndex: 1,
          amount: 600,
          eligibleSeats: [1, 3],
          winners: [
            { seat: 1, amount: 300 },
            { seat: 3, amount: 300 },
          ],
          description: 'Straight, Ten high',
        },
        name,
      ),
    ).toBe('alice (300), carol (300) win side pot 1 of 600 with Straight, Ten high.');
    expect(describeEvent({ kind: 'HOLE_CARDS_DEALT', seats: [1, 2] }, name)).toBeNull();
  });
});

describe('tournament log lines', () => {
  const name = () => 'carol';
  it('describes eliminations and the finish', () => {
    expect(
      describeEvent(
        { kind: 'PLAYER_LEFT', seat: 1, userId: 'u', reason: 'ELIMINATED', cashOut: 0, place: 3 },
        name,
      ),
    ).toBe('carol is eliminated in 3rd place.');
    expect(
      describeEvent(
        { kind: 'PLAYER_LEFT', seat: 1, userId: 'u', reason: 'FINISHED', cashOut: 0, place: 1 },
        name,
      ),
    ).toBe('carol wins the tournament!');
  });
});

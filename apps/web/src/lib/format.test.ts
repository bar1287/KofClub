import { cardParts, chips } from './format';

describe('format', () => {
  it('formats chips with grouping', () => {
    expect(chips(1234567)).toBe('1,234,567');
  });
  it('renders cards', () => {
    expect(cardParts('Td')).toEqual({
      rank: '10',
      symbol: '♦',
      red: true,
      label: 'Ten of diamonds',
    });
    expect(cardParts('As')).toMatchObject({ rank: 'A', symbol: '♠', red: false });
  });
});

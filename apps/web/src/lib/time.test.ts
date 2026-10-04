import { ordinal } from './format';
import { formatCountdown } from './time';

describe('time and ordinal formatting', () => {
  it('formats countdowns', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
    expect(formatCountdown(-5)).toBe('0:00');
  });
  it('formats places', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '103rd',
    ]);
  });
});

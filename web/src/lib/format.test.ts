import { describe, expect, it } from 'vitest';
import { formatClock } from './format';

describe('formatClock', () => {
  it('shows local time on a 12-hour clock with AM/PM', () => {
    expect(formatClock('2026-10-28T08:33:25.000Z')).toMatch(/^(1[0-2]|[1-9]):[0-5]\d:[0-5]\d\s?(AM|PM)$/);
    expect(formatClock(Date.parse('2026-10-28T08:33:25.000Z'))).toBe(formatClock('2026-10-28T08:33:25.000Z'));
  });

  it('shows a dash for an invalid time', () => {
    expect(formatClock('not a date')).toBe('—');
  });
});

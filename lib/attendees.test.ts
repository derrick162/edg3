import { describe, it, expect } from 'vitest';
import { mergeAttendees, type AttendeeLike } from './attendees';

const cur: AttendeeLike[] = [
  { email: 'alice@co.com', displayName: 'Alice', responseStatus: 'accepted' },
  { email: 'bob@co.com', displayName: 'Bob' },
];

describe('mergeAttendees (R14 T3)', () => {
  it('adds a new attendee, preserving existing ones', () => {
    const out = mergeAttendees(cur, [{ email: 'carol@co.com', name: 'Carol' }], []);
    expect(out.map(a => a.email)).toEqual(['alice@co.com', 'bob@co.com', 'carol@co.com']);
    expect(out.find(a => a.email === 'carol@co.com')?.displayName).toBe('Carol');
  });

  it('preserves an existing attendee responseStatus when not re-added', () => {
    const out = mergeAttendees(cur, [{ email: 'carol@co.com' }], []);
    expect(out.find(a => a.email === 'alice@co.com')?.responseStatus).toBe('accepted');
  });

  it('removes by email (case-insensitive)', () => {
    const out = mergeAttendees(cur, [], ['ALICE@co.com']);
    expect(out.map(a => a.email)).toEqual(['bob@co.com']);
  });

  it('dedups when adding someone already present (updates name only)', () => {
    const out = mergeAttendees(cur, [{ email: 'bob@co.com', name: 'Bobby' }], []);
    expect(out).toHaveLength(2);
    expect(out.find(a => a.email === 'bob@co.com')?.displayName).toBe('Bobby');
  });

  it('a removed email is never re-added even if also in add', () => {
    const out = mergeAttendees(cur, [{ email: 'alice@co.com', name: 'Alice2' }], ['alice@co.com']);
    expect(out.map(a => a.email)).toEqual(['bob@co.com']);
  });

  it('ignores add entries without a valid email', () => {
    const out = mergeAttendees(cur, [{ name: 'NoEmail' }, { email: 'notanemail' }], []);
    expect(out).toHaveLength(2);
  });
});

import { describe, it, expect } from 'vitest';
import { isWritable, canUserReschedule } from './calendarWritable';

describe('isWritable', () => {
  it('owner is writable', () => expect(isWritable('owner')).toBe(true));
  it('writer is writable', () => expect(isWritable('writer')).toBe(true));
  it('reader is not writable', () => expect(isWritable('reader')).toBe(false));
  it('freeBusyReader is not writable', () => expect(isWritable('freeBusyReader')).toBe(false));
  it('empty string is not writable', () => expect(isWritable('')).toBe(false));
  it('unknown role defaults to not writable', () => expect(isWritable('unknown')).toBe(false));
});

describe('canUserReschedule', () => {
  it('returns true when organizer.self is true (user is organizer)', () => {
    expect(canUserReschedule({ organizer: { self: true } })).toBe(true);
  });

  it('returns false when organizer.self is false and guestsCanModify is false', () => {
    expect(canUserReschedule({ organizer: { self: false }, guestsCanModify: false })).toBe(false);
  });

  it('returns false when organizer.self is undefined and guestsCanModify is false', () => {
    expect(canUserReschedule({ organizer: { self: undefined }, guestsCanModify: false })).toBe(false);
  });

  it('returns true when user is not organizer but guestsCanModify is true', () => {
    expect(canUserReschedule({ organizer: { self: false }, guestsCanModify: true })).toBe(true);
  });

  it('returns true when organizer is null (no organizer info — benefit of the doubt)', () => {
    expect(canUserReschedule({ organizer: null })).toBe(true);
  });

  it('returns true when organizer is absent entirely (self-created events)', () => {
    expect(canUserReschedule({})).toBe(true);
  });

  it('returns false when organizer.self is false and guestsCanModify is absent', () => {
    expect(canUserReschedule({ organizer: { self: false } })).toBe(false);
  });
});

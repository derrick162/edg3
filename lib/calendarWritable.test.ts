import { describe, it, expect } from 'vitest';
import { isWritable } from './calendarWritable';

describe('isWritable', () => {
  it('owner is writable', () => expect(isWritable('owner')).toBe(true));
  it('writer is writable', () => expect(isWritable('writer')).toBe(true));
  it('reader is not writable', () => expect(isWritable('reader')).toBe(false));
  it('freeBusyReader is not writable', () => expect(isWritable('freeBusyReader')).toBe(false));
  it('empty string is not writable', () => expect(isWritable('')).toBe(false));
  it('unknown role defaults to not writable', () => expect(isWritable('unknown')).toBe(false));
});

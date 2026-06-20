import { describe, it, expect } from 'vitest';
import {
  GOOGLE_SCOPES,
  GMAIL_READONLY_SCOPE,
  CALENDAR_SCOPES,
  parseScopes,
  hasGmailReadScope,
  missingRequiredScopes,
} from './google-auth';

const CAL_ONLY = CALENDAR_SCOPES.join(' ');
const CAL_PLUS_GMAIL = GOOGLE_SCOPES.join(' ');
// R12 T2: gmail.compose was removed; keep a literal here only to assert it's NOT requested anymore.
const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';

describe('google-auth scope helpers', () => {
  it('no longer requests gmail.compose (R12 T2 — drafting removed)', () => {
    expect(GOOGLE_SCOPES).not.toContain(GMAIL_COMPOSE_SCOPE);
  });

  it('parseScopes splits on whitespace and drops empties', () => {
    expect(parseScopes('a  b\tc')).toEqual(['a', 'b', 'c']);
    expect(parseScopes('')).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
  });

  it('missingRequiredScopes flags gmail.readonly for a calendar-only user', () => {
    expect(missingRequiredScopes(CAL_ONLY)).toEqual([GMAIL_READONLY_SCOPE]);
    expect(missingRequiredScopes(CAL_PLUS_GMAIL)).toEqual([]);
    expect(missingRequiredScopes(null)).toEqual(GOOGLE_SCOPES);
  });

  it('includes gmail.readonly in the requested scope set', () => {
    expect(GOOGLE_SCOPES).toContain(GMAIL_READONLY_SCOPE);
  });

  it('hasGmailReadScope is false without the readonly scope', () => {
    expect(hasGmailReadScope(CAL_ONLY)).toBe(false);
    expect(hasGmailReadScope(CALENDAR_SCOPES.join(' ') + ' ' + GMAIL_COMPOSE_SCOPE)).toBe(false);
    expect(hasGmailReadScope(null)).toBe(false);
  });

  it('hasGmailReadScope is true once gmail.readonly is granted', () => {
    expect(hasGmailReadScope(CAL_PLUS_GMAIL)).toBe(true);
    expect(hasGmailReadScope(GMAIL_READONLY_SCOPE)).toBe(true);
  });
});

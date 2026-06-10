import { describe, it, expect } from 'vitest';
import {
  GOOGLE_SCOPES,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
  CALENDAR_SCOPES,
  parseScopes,
  hasGmailScope,
  hasGmailReadScope,
  missingRequiredScopes,
} from './google-auth';

const CAL_ONLY = CALENDAR_SCOPES.join(' ');
const CAL_PLUS_GMAIL = GOOGLE_SCOPES.join(' ');

describe('google-auth scope helpers', () => {
  it('includes gmail.compose in the requested scope set', () => {
    expect(GOOGLE_SCOPES).toContain(GMAIL_COMPOSE_SCOPE);
  });

  it('parseScopes splits on whitespace and drops empties', () => {
    expect(parseScopes('a  b\tc')).toEqual(['a', 'b', 'c']);
    expect(parseScopes('')).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
  });

  it('hasGmailScope is false for a calendar-only grant (existing users)', () => {
    expect(hasGmailScope(CAL_ONLY)).toBe(false);
    expect(hasGmailScope(null)).toBe(false);
  });

  it('hasGmailScope is true once gmail.compose is granted', () => {
    expect(hasGmailScope(CAL_PLUS_GMAIL)).toBe(true);
  });

  it('missingRequiredScopes flags both Gmail scopes for a calendar-only user', () => {
    expect(missingRequiredScopes(CAL_ONLY)).toEqual([GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE]);
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

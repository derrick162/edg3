/**
 * C10 — address-fact verification. STT mishears street names and the wrong address lands as a
 * high-confidence fact. We detect address-like facts, verify them against OpenStreetMap Nominatim,
 * and FLAG (never auto-correct) the ones that don't resolve. Real in-memory DB; fetch is mocked.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, factQueries } = await import('./db');
const {
  looksLikeAddress,
  addressQueryFromStatement,
  verifyAddressViaNominatim,
  flagUnverifiedAddressFacts,
  ADDRESS_UNVERIFIED_MARKER,
} = await import('./facts');

afterAll(() => { delete process.env.DB_PATH; vi.unstubAllGlobals(); });

// Nominatim response: [] = no match, [{...}] = a match.
function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: impl })));
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['facts', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
  vi.unstubAllGlobals();
});

describe('looksLikeAddress', () => {
  it('flags statements with a street number + street-type word', () => {
    expect(looksLikeAddress('lives at 123 Queens Quay East')).toBe(true);
    expect(looksLikeAddress('office at 45 King Street West')).toBe(true);
    expect(looksLikeAddress('meet at 1 Yonge Blvd')).toBe(true);
  });
  it('does NOT flag non-addresses or already-flagged facts', () => {
    expect(looksLikeAddress('ran 5 miles this morning')).toBe(false);
    expect(looksLikeAddress('likes oat-milk lattes')).toBe(false);
    expect(looksLikeAddress('heads east on weekends')).toBe(false); // no street number
    expect(looksLikeAddress(null)).toBe(false);
    expect(looksLikeAddress(`123 Fake Quay ${ADDRESS_UNVERIFIED_MARKER}`)).toBe(false); // already flagged
  });
});

describe('addressQueryFromStatement', () => {
  it('extracts the span from the first street number onward', () => {
    expect(addressQueryFromStatement('lives at 123 Queens Quay East, Toronto')).toBe('123 Queens Quay East, Toronto');
    expect(addressQueryFromStatement('45 King St West')).toBe('45 King St West');
  });
});

describe('verifyAddressViaNominatim', () => {
  it('returns true when Nominatim returns ≥1 result', async () => {
    stubFetch(async () => [{ lat: '43.6', lon: '-79.3' }]);
    expect(await verifyAddressViaNominatim('1 Yonge St, Toronto')).toBe(true);
  });
  it('returns false when Nominatim returns 0 results', async () => {
    stubFetch(async () => []);
    expect(await verifyAddressViaNominatim('123 Queenskey East')).toBe(false);
  });
  it('returns null (inconclusive) on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] })));
    expect(await verifyAddressViaNominatim('anywhere')).toBeNull();
  });
  it('returns null (inconclusive) when the request throws/times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted'); }));
    expect(await verifyAddressViaNominatim('anywhere')).toBeNull();
  });
});

describe('flagUnverifiedAddressFacts', () => {
  it('flags an address fact that does NOT geocode (confidence → low + marker)', async () => {
    factQueries.upsertFact(1, 'fact', 'office at 123 Queenskey East', 'office', 'high');
    stubFetch(async () => []); // Nominatim: no match
    const flagged = await flagUnverifiedAddressFacts(1);
    expect(flagged).toBe(1);
    const f = factQueries.getByCategory(1, 'fact')[0];
    expect(f.statement).toContain(ADDRESS_UNVERIFIED_MARKER);
    expect(f.confidence).toBe('low');
  });

  it('leaves a verified address fact untouched (still high, no marker)', async () => {
    factQueries.upsertFact(1, 'fact', 'office at 1 Yonge Street, Toronto', 'office', 'high');
    stubFetch(async () => [{ lat: '43.6', lon: '-79.3' }]); // Nominatim: match
    const flagged = await flagUnverifiedAddressFacts(1);
    expect(flagged).toBe(0);
    const f = factQueries.getByCategory(1, 'fact')[0];
    expect(f.statement).not.toContain(ADDRESS_UNVERIFIED_MARKER);
    expect(f.confidence).toBe('high');
  });

  it('does NOT downgrade on an inconclusive (null) geocode result', async () => {
    factQueries.upsertFact(1, 'fact', 'office at 99 Maybe Road', 'office', 'high');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const flagged = await flagUnverifiedAddressFacts(1);
    expect(flagged).toBe(0);
    expect(factQueries.getByCategory(1, 'fact')[0].confidence).toBe('high');
  });

  it('ignores non-address facts entirely (no geocode call)', async () => {
    factQueries.upsertFact(1, 'fact', 'prefers tea over coffee', null, 'high');
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const flagged = await flagUnverifiedAddressFacts(1);
    expect(flagged).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

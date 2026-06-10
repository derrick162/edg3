import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkVapiSecret } from './vapi';

// checkVapiSecret reads process.env — stub it cleanly per test.
const env = process.env;

beforeEach(() => {
  // Reset env to a clean slate before each test.
  vi.stubEnv('VAPI_SERVER_SECRET', '');
  vi.stubEnv('VAPI_SECRET_ENFORCE', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('checkVapiSecret', () => {
  describe('VAPI_SERVER_SECRET unset', () => {
    it('accepts any header value (not yet configured)', () => {
      vi.stubEnv('VAPI_SERVER_SECRET', '');
      expect(checkVapiSecret('anything')).toEqual({ ok: true, status: 'accepted' });
    });

    it('accepts null header (not yet configured)', () => {
      vi.stubEnv('VAPI_SERVER_SECRET', '');
      expect(checkVapiSecret(null)).toEqual({ ok: true, status: 'accepted' });
    });
  });

  describe('VAPI_SERVER_SECRET set, VAPI_SECRET_ENFORCE off (Stage A — fail-open)', () => {
    beforeEach(() => {
      vi.stubEnv('VAPI_SERVER_SECRET', 'supersecret');
      vi.stubEnv('VAPI_SECRET_ENFORCE', ''); // not set = fail-open
    });

    it('accepts a matching secret', () => {
      expect(checkVapiSecret('supersecret')).toEqual({ ok: true, status: 'accepted' });
    });

    it('accepts (but logs) a wrong secret during fail-open window', () => {
      const result = checkVapiSecret('wrongsecret');
      expect(result.ok).toBe(true);          // fail-open → still accepted
      expect(result.status).toBe('mismatch-allowed');
    });

    it('accepts (but logs) a missing header during fail-open window', () => {
      const result = checkVapiSecret(null);
      expect(result.ok).toBe(true);
      expect(result.status).toBe('mismatch-allowed');
    });

    it('does not accept when VAPI_SECRET_ENFORCE is set to anything other than "true"', () => {
      vi.stubEnv('VAPI_SECRET_ENFORCE', 'false'); // explicit false = still fail-open
      expect(checkVapiSecret('wrongsecret')).toEqual({ ok: true, status: 'mismatch-allowed' });
    });
  });

  describe('VAPI_SERVER_SECRET set, VAPI_SECRET_ENFORCE=true (Stage B — enforce)', () => {
    beforeEach(() => {
      vi.stubEnv('VAPI_SERVER_SECRET', 'supersecret');
      vi.stubEnv('VAPI_SECRET_ENFORCE', 'true');
    });

    it('accepts a matching secret', () => {
      expect(checkVapiSecret('supersecret')).toEqual({ ok: true, status: 'accepted' });
    });

    it('rejects a wrong secret', () => {
      const result = checkVapiSecret('wrongsecret');
      expect(result.ok).toBe(false);
      expect(result.status).toBe('rejected');
    });

    it('rejects a missing header', () => {
      const result = checkVapiSecret(null);
      expect(result.ok).toBe(false);
      expect(result.status).toBe('rejected');
    });

    it('rejects an empty-string header', () => {
      const result = checkVapiSecret('');
      expect(result.ok).toBe(false);
      expect(result.status).toBe('rejected');
    });
  });
});

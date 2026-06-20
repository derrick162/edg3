import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkVapiSecret, VOICES, initiateCall } from './vapi';

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

// ── VOICES map ────────────────────────────────────────────────────────────────

describe('VOICES', () => {
  it('daniel config uses 11labs provider with Daniel voiceId', () => {
    expect(VOICES.daniel.provider).toBe('11labs');
    expect(VOICES.daniel.voiceId).toBe('3WqHLnw80rOZqJzW9YRB');
    expect(VOICES.daniel.model).toBe('eleven_turbo_v2_5');
    expect(VOICES.daniel.stability).toBe(0.55);
    expect(VOICES.daniel.similarityBoost).toBe(0.75);
    expect(VOICES.daniel.speed).toBe(0.9); // R9 T1 — slowed down from default
  });

  it('aria config uses 11labs provider with aria voiceId', () => {
    expect(VOICES.aria.provider).toBe('11labs');
    expect(VOICES.aria.voiceId).toBe('cgSgspJ2msm6clMCkdW9');
    expect(VOICES.aria.model).toBe('eleven_turbo_v2_5');
    expect(VOICES.aria.speed).toBe(0.9); // R9 T1 — slowed down from default
    expect(VOICES.aria.stability).toBe(0.4);
    expect(VOICES.aria.similarityBoost).toBe(0.7);
  });

  it('daniel and aria voiceIds are distinct', () => {
    expect(VOICES.daniel.voiceId).not.toBe(VOICES.aria.voiceId);
  });
});

// ── initiateCall voice override ───────────────────────────────────────────────
// Note: VAPI_API_KEY is captured at module-load time, so we can't stub it via vi.stubEnv.
// Instead we use vi.resetModules() + dynamic import to get a fresh module with the env set.

describe('initiateCall voice override', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function importFresh() {
    vi.resetModules();
    return import('./vapi');
  }

  function mockFetch(body: object) {
    return vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => body,
    } as Response);
  }

  it('sends daniel voice by default (no voicePref arg)', async () => {
    vi.stubEnv('VAPI_API_KEY', 'test-key');
    vi.stubEnv('VAPI_PHONE_NUMBER_ID', 'test-phone-id');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.edg3.ai');
    const spy = mockFetch({ id: 'call-1', status: 'queued', phoneNumber: '+1' });
    const { initiateCall: call, VOICES: V } = await importFresh();
    await call('+15551234567', 'Hello', 'Test User');
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.assistant.voice.voiceId).toBe(V.daniel.voiceId);
  });

  it('sends aria voice when voicePref is "aria"', async () => {
    vi.stubEnv('VAPI_API_KEY', 'test-key');
    vi.stubEnv('VAPI_PHONE_NUMBER_ID', 'test-phone-id');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.edg3.ai');
    const spy = mockFetch({ id: 'call-3', status: 'queued', phoneNumber: '+1' });
    const { initiateCall: call, VOICES: V } = await importFresh();
    await call('+15551234567', 'Hello', 'Test User', false, 'America/Vancouver', false, '', '', '', '', '', 'aria');
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.assistant.voice.voiceId).toBe(V.aria.voiceId);
  });

  it('includes voice in assistantOverrides when VAPI_ASSISTANT_ID is set', async () => {
    vi.stubEnv('VAPI_API_KEY', 'test-key');
    vi.stubEnv('VAPI_PHONE_NUMBER_ID', 'test-phone-id');
    vi.stubEnv('VAPI_ASSISTANT_ID', 'asst-abc123');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.edg3.ai');
    const spy = mockFetch({ id: 'call-4', status: 'queued', phoneNumber: '+1' });
    const { initiateCall: call, VOICES: V } = await importFresh();
    await call('+15551234567', 'Hello', 'Test User', false, 'America/Vancouver', false, '', '', '', '', '', 'aria');
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.assistantOverrides.voice.voiceId).toBe(V.aria.voiceId);
  });
});

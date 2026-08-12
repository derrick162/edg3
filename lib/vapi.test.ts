import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkVapiSecret, VOICES, VOICES_11LABS, SPEED_MAP, initiateCall, vapiCallDurationSeconds, MIN_COMPLETED_CALL_SECONDS, isAfterQuietHours, QUIET_HOURS_END } from './vapi';

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

describe('VOICES (TEMP Azure stopgap 2026-08-12 — Vapi ElevenLabs credential rejected server-side)', () => {
  it('daniel is temporarily the Azure Andrew voice', () => {
    expect(VOICES.daniel.provider).toBe('azure');
    expect(VOICES.daniel.voiceId).toBe('en-US-AndrewNeural');
    expect(VOICES.daniel.speed).toBe(0.9); // R9 T1 — slowed down from default
  });

  it('aria is temporarily the Azure Aria voice', () => {
    expect(VOICES.aria.provider).toBe('azure');
    expect(VOICES.aria.voiceId).toBe('en-US-AriaNeural');
    expect(VOICES.aria.speed).toBe(0.9);
  });

  it('daniel and aria voiceIds are distinct', () => {
    expect(VOICES.daniel.voiceId).not.toBe(VOICES.aria.voiceId);
  });

  // Preserved originals — the revert target once the ElevenLabs key is re-saved in Vapi.
  it('VOICES_11LABS keeps the original ElevenLabs configs intact for the revert', () => {
    expect(VOICES_11LABS.daniel.provider).toBe('11labs');
    expect(VOICES_11LABS.daniel.voiceId).toBe('3WqHLnw80rOZqJzW9YRB');
    expect(VOICES_11LABS.daniel.model).toBe('eleven_turbo_v2_5');
    expect(VOICES_11LABS.daniel.stability).toBe(0.55);
    expect(VOICES_11LABS.daniel.similarityBoost).toBe(0.75);
    expect(VOICES_11LABS.aria.provider).toBe('11labs');
    expect(VOICES_11LABS.aria.voiceId).toBe('cgSgspJ2msm6clMCkdW9');
    expect(VOICES_11LABS.aria.stability).toBe(0.4);
    expect(VOICES_11LABS.aria.similarityBoost).toBe(0.7);
  });
});

// ── SPEED_MAP (R12 T6) ────────────────────────────────────────────────────────
describe('SPEED_MAP', () => {
  it('maps each preset to its ElevenLabs speed value', () => {
    expect(SPEED_MAP.slow).toBe(0.75);
    expect(SPEED_MAP.default).toBe(0.9);
    expect(SPEED_MAP.fast).toBe(1.1);
  });

  it('default preset matches the VOICES baseline speed', () => {
    expect(SPEED_MAP.default).toBe(VOICES.daniel.speed);
  });
});

// ── initiateCall voice override ───────────────────────────────────────────────
// Note: VAPI_API_KEY is captured at module-load time, so we can't stub it via vi.stubEnv.
// Instead we use vi.resetModules() + dynamic import to get a fresh module with the env set.

describe('initiateCall voice override', () => {
  beforeEach(() => {
    // Freeze the clock at 1 PM Vancouver — initiateCall now enforces the 7 AM quiet-hours
    // floor against the REAL clock, so these tests must not depend on when the suite runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T20:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('QUIET HOURS: refuses to place any call before 7 AM local — no Vapi request at all', async () => {
    vi.setSystemTime(new Date('2026-08-11T13:30:00Z')); // 6:30 AM in America/Vancouver (default tz)
    vi.stubEnv('VAPI_API_KEY', 'test-key');
    vi.stubEnv('VAPI_PHONE_NUMBER_ID', 'test-phone-id');
    const spy = mockFetch({ id: 'call-q', status: 'queued', phoneNumber: '+1' });
    const { initiateCall: call } = await importFresh();
    await expect(call('+15551234567', 'Hello', 'Test User')).rejects.toThrow(/QUIET_HOURS/);
    expect(spy).not.toHaveBeenCalled();
  });

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

  it('R22: language="yue" swaps in Whisper STT + Azure Cantonese voice', async () => {
    vi.setSystemTime(new Date('2026-08-11T01:00:00Z')); // 9 AM in Asia/Hong_Kong — past the quiet-hours floor
    vi.stubEnv('VAPI_API_KEY', 'test-key');
    vi.stubEnv('VAPI_PHONE_NUMBER_ID', 'test-phone-id');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.edg3.ai');
    const spy = mockFetch({ id: 'call-yue', status: 'queued', phoneNumber: '+1' });
    const { initiateCall: call } = await importFresh();
    // positional: …voicePref, voiceSpeed, gratitudeSystemPrompt(null), language('yue')
    await call('+15551234567', '早晨', 'Test User', false, 'Asia/Hong_Kong', false, '', '', '', '', '', 'daniel', 'default', null, 'yue');
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.assistant.transcriber.provider).toBe('openai');
    expect(body.assistant.voice.provider).toBe('azure');
    expect(body.assistant.voice.voiceId).toBe('zh-HK-WanLungNeural');
  });

  it('R23 hotfix: system prompt enforces TOOL CALL DISCIPLINE', async () => {
    vi.stubEnv('VAPI_API_KEY', 'test-key');
    vi.stubEnv('VAPI_PHONE_NUMBER_ID', 'test-phone-id');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.edg3.ai');
    const spy = mockFetch({ id: 'call-disc', status: 'queued', phoneNumber: '+1' });
    const { initiateCall: call } = await importFresh();
    await call('+15551234567', 'Hello', 'Test User');
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.assistant.model.systemPrompt).toContain('TOOL CALL DISCIPLINE');
  });
});

describe('vapiCallDurationSeconds', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(vapiCallDurationSeconds(null)).toBeNull();
    expect(vapiCallDurationSeconds(undefined)).toBeNull();
    expect(vapiCallDurationSeconds({})).toBeNull();
  });

  it('prefers an explicit durationSeconds', () => {
    expect(vapiCallDurationSeconds({ durationSeconds: 42 })).toBe(42);
    expect(vapiCallDurationSeconds({ durationSeconds: 0 })).toBe(0);
  });

  it('reads durationSeconds from a nested call object', () => {
    expect(vapiCallDurationSeconds({ call: { durationSeconds: 12 } })).toBe(12);
  });

  it('computes endedAt − startedAt when no explicit duration', () => {
    expect(vapiCallDurationSeconds({
      startedAt: '2026-07-01T08:00:00.000Z',
      endedAt: '2026-07-01T08:00:15.000Z',
    })).toBe(15);
  });

  it('computes duration from a nested call object timestamps', () => {
    expect(vapiCallDurationSeconds({
      call: { startedAt: '2026-07-01T08:00:00.000Z', endedAt: '2026-07-01T08:03:00.000Z' },
    })).toBe(180);
  });

  it('returns null on unparseable or reversed timestamps', () => {
    expect(vapiCallDurationSeconds({ startedAt: 'nope', endedAt: 'also-nope' })).toBeNull();
    expect(vapiCallDurationSeconds({
      startedAt: '2026-07-01T08:00:15.000Z',
      endedAt: '2026-07-01T08:00:00.000Z',
    })).toBeNull();
  });

  it('a declined/instant call falls under the completed-call threshold', () => {
    const dur = vapiCallDurationSeconds({
      startedAt: '2026-07-01T08:00:00.000Z',
      endedAt: '2026-07-01T08:00:03.000Z',
    });
    expect(dur).not.toBeNull();
    expect(dur! < MIN_COMPLETED_CALL_SECONDS).toBe(true);
  });

  it('a real briefing clears the completed-call threshold', () => {
    const dur = vapiCallDurationSeconds({ durationSeconds: 125 });
    expect(dur! >= MIN_COMPLETED_CALL_SECONDS).toBe(true);
  });
});

// Derrick 2026-08-11: "no matter what, Edge doesn't call until after 7 am." The floor is
// enforced inside initiateCall (the choke point for EVERY outbound call path), driven by
// this pure helper. Fixed UTC instants → known local hours, DST-current for August.
describe(`quiet hours — no calls before ${QUIET_HOURS_END} AM local`, () => {
  it('6:30 AM in Toronto (EDT) is inside quiet hours', () => {
    expect(isAfterQuietHours('America/Toronto', new Date('2026-08-11T10:30:00Z'))).toBe(false);
  });

  it('7:00 AM sharp in Toronto is allowed (floor is inclusive)', () => {
    expect(isAfterQuietHours('America/Toronto', new Date('2026-08-11T11:00:00Z'))).toBe(true);
  });

  it('9:05 AM in Toronto is allowed', () => {
    expect(isAfterQuietHours('America/Toronto', new Date('2026-08-11T13:05:00Z'))).toBe(true);
  });

  it('6:59 AM in Vancouver (PDT) is inside quiet hours while Toronto is well past 7', () => {
    expect(isAfterQuietHours('America/Vancouver', new Date('2026-08-11T13:59:00Z'))).toBe(false);
    expect(isAfterQuietHours('America/Toronto', new Date('2026-08-11T13:59:00Z'))).toBe(true);
  });

  it('midnight and small hours are inside quiet hours', () => {
    expect(isAfterQuietHours('America/Toronto', new Date('2026-08-11T04:10:00Z'))).toBe(false); // 00:10 EDT
    expect(isAfterQuietHours('America/Toronto', new Date('2026-08-11T08:00:00Z'))).toBe(false); // 04:00 EDT
  });

  it('late evening is NOT quiet hours (only the pre-7AM floor was requested)', () => {
    expect(isAfterQuietHours('America/Toronto', new Date('2026-08-11T02:30:00Z'))).toBe(true); // 22:30 EDT Aug 10
  });
});

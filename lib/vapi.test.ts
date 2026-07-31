import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkVapiSecret, VOICES, SPEED_MAP, initiateCall, vapiCallDurationSeconds, MIN_COMPLETED_CALL_SECONDS, extractRecordingUrl } from './vapi';

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

  it('R22: language="yue" swaps in Whisper STT + Azure Cantonese voice', async () => {
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

describe('extractRecordingUrl', () => {
  it('returns null for null/undefined/empty', () => {
    expect(extractRecordingUrl(null)).toBeNull();
    expect(extractRecordingUrl(undefined)).toBeNull();
    expect(extractRecordingUrl({})).toBeNull();
    expect(extractRecordingUrl({ artifact: null })).toBeNull();
  });

  it('reads artifact.recordingUrl (the usual end-of-call-report shape)', () => {
    expect(extractRecordingUrl({ artifact: { recordingUrl: 'https://vapi/rec.wav' } })).toBe('https://vapi/rec.wav');
  });

  it('falls back to a top-level recordingUrl', () => {
    expect(extractRecordingUrl({ recordingUrl: 'https://vapi/top.wav' })).toBe('https://vapi/top.wav');
  });

  it('falls back to stereoRecordingUrl when mono is absent', () => {
    expect(extractRecordingUrl({ artifact: { stereoRecordingUrl: 'https://vapi/stereo.wav' } })).toBe('https://vapi/stereo.wav');
  });

  it('prefers mono recordingUrl over stereo', () => {
    expect(extractRecordingUrl({ artifact: { recordingUrl: 'mono', stereoRecordingUrl: 'stereo' } })).toBe('mono');
  });

  it('returns null when the recording is not ready (call-ended shape)', () => {
    expect(extractRecordingUrl({ artifact: { transcript: 'hi' } as never })).toBeNull();
  });
});

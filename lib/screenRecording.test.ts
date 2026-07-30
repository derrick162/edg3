import { describe, it, expect } from 'vitest';
import {
  MAX_SCREEN_RECORDING_SECONDS,
  pickScreenRecordingMime,
  screenRecordingFilename,
  formatDuration,
} from './screenRecording';

describe('MAX_SCREEN_RECORDING_SECONDS', () => {
  it('is a 5-minute cap', () => {
    expect(MAX_SCREEN_RECORDING_SECONDS).toBe(300);
  });
});

describe('pickScreenRecordingMime', () => {
  it('prefers vp9 webm when everything is supported', () => {
    expect(pickScreenRecordingMime(() => true)).toBe('video/webm;codecs=vp9');
  });

  it('falls back to plain webm when vp9/vp8 unsupported', () => {
    expect(pickScreenRecordingMime((t) => t === 'video/webm' || t === 'video/mp4')).toBe('video/webm');
  });

  it('falls back to mp4 when only mp4 is supported (Safari-ish)', () => {
    expect(pickScreenRecordingMime((t) => t === 'video/mp4')).toBe('video/mp4');
  });

  it('returns empty string when nothing is supported', () => {
    expect(pickScreenRecordingMime(() => false)).toBe('');
  });

  it('treats a probe that throws as unsupported', () => {
    expect(pickScreenRecordingMime(() => { throw new Error('probe failed'); })).toBe('');
  });
});

describe('screenRecordingFilename', () => {
  it('stamps local date and time, zero-padded, .webm extension', () => {
    // Local time constructor → deterministic getters regardless of test TZ.
    expect(screenRecordingFilename(new Date(2026, 6, 30, 9, 5))).toBe('edge-journal-screen-2026-07-30-0905.webm');
    expect(screenRecordingFilename(new Date(2026, 11, 1, 14, 30))).toBe('edge-journal-screen-2026-12-01-1430.webm');
  });
});

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(MAX_SCREEN_RECORDING_SECONDS)).toBe('5:00');
  });

  it('clamps negative/fractional input', () => {
    expect(formatDuration(-3)).toBe('0:00');
    expect(formatDuration(9.9)).toBe('0:09');
  });
});

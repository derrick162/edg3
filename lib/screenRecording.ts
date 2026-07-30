// Client-side desktop screen recording for Journaling Mode (video-only, no audio).
// The recording is downloaded straight to the user's computer — nothing is uploaded or
// stored server-side, so this needs no object storage. Pure helpers here are unit-tested;
// the browser MediaRecorder/getDisplayMedia wiring lives in the dashboard component.

// Hard cap: a screen recording auto-stops at 5 minutes.
export const MAX_SCREEN_RECORDING_SECONDS = 300;

// Preference order for the recorded container/codec. First one the browser supports wins.
const CANDIDATE_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

/**
 * Pick the first screen-recording MIME type the browser's MediaRecorder supports.
 * `isSupported` is injectable for testing; defaults to MediaRecorder.isTypeSupported.
 * Returns '' when none match (caller lets MediaRecorder choose its own default).
 */
export function pickScreenRecordingMime(
  isSupported?: (t: string) => boolean,
): string {
  const check = isSupported
    ?? ((t: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  for (const t of CANDIDATE_MIME_TYPES) {
    try { if (check(t)) return t; } catch { /* ignore probe errors */ }
  }
  return '';
}

/**
 * Download filename for a screen recording, stamped with local date+time so entries are
 * easy to match to a journal call, e.g. "edge-journal-screen-2026-07-30-0915.webm".
 */
export function screenRecordingFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `edge-journal-screen-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.webm`;
}

/** Format seconds as m:ss for the live recording timer (e.g. 65 -> "1:05"). */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

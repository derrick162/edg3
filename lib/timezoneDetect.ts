// R35 — browser timezone auto-detect. Pure decision helper (no I/O, no DOM) so the "when do we
// persist the detected zone?" rule is unit-testable. The dashboard reads the browser zone via
// Intl.DateTimeFormat().resolvedOptions().timeZone and calls this to decide whether to POST it.
//
// Closes the failure class behind the 2026-06-24 incident: an unset timezone made effectiveTimezone
// fall back to America/Los_Angeles, so every time-aware feature ran hours behind.

export function pickTimezoneUpdate(
  storedCurrentTz: string | null | undefined,
  detectedTz: string | null | undefined,
): string | null {
  // No detected zone (SSR / Intl unavailable) → never POST.
  if (!detectedTz || !detectedTz.trim()) return null;
  const detected = detectedTz.trim();
  const stored = (storedCurrentTz ?? '').trim();
  // Unset → fill it (the core bug). Differs → follow the user's move. Already correct → no-op.
  if (!stored) return detected;
  if (stored !== detected) return detected;
  return null;
}

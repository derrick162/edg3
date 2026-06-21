// R14 T3 — pure attendee-list merge for editEventAttendees. The I/O handler resolves
// the event + patches Google; this computes the new attendee array (add, dedup, remove).

export interface AttendeeLike {
  email?: string | null;
  displayName?: string | null;
  responseStatus?: string | null;
}

/**
 * Merge `add` into `current` (dedup by lowercased email, preserving existing fields
 * like responseStatus) and drop anyone whose email is in `remove`. A removed email is
 * never re-added even if also present in `add`.
 */
export function mergeAttendees(
  current: AttendeeLike[],
  add: { email?: string; name?: string }[],
  remove: string[],
): AttendeeLike[] {
  const removeSet = new Set((remove ?? []).filter(Boolean).map(e => e.toLowerCase()));
  const byEmail = new Map<string, AttendeeLike>();

  for (const a of current ?? []) {
    const key = a.email?.toLowerCase();
    if (key && !removeSet.has(key)) byEmail.set(key, a);
  }
  for (const a of add ?? []) {
    const email = a.email?.trim();
    if (!email || !/@/.test(email)) continue;
    const key = email.toLowerCase();
    if (removeSet.has(key)) continue;
    const existing = byEmail.get(key);
    byEmail.set(key, {
      ...existing,
      email,
      ...(a.name ? { displayName: a.name } : {}),
    });
  }
  return [...byEmail.values()];
}

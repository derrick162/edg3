// R14 T4 — pure matcher for completeTask: pick the open task a spoken title refers to.
// Exact (normalized) match wins; else a unique substring match; ties → ambiguous.

import { normalizeTitle } from './eventMatch';

export interface TaskLike { id: number; text: string }

export interface TaskMatchResult {
  match: TaskLike | null;     // the single task to complete, if unambiguous
  ambiguous: TaskLike[];      // 2+ equally-plausible matches → ask which
}

/**
 * Resolve `title` against a list of open tasks.
 * 1. Exact normalized equality — one → match, many → ambiguous.
 * 2. Else substring (either direction) — one → match, many → ambiguous.
 * 3. Else no match.
 */
export function pickTaskToComplete(tasks: TaskLike[], title: string): TaskMatchResult {
  const q = normalizeTitle(title || '');
  if (!q) return { match: null, ambiguous: [] };

  const exact = tasks.filter(t => normalizeTitle(t.text) === q);
  if (exact.length === 1) return { match: exact[0], ambiguous: [] };
  if (exact.length > 1) return { match: null, ambiguous: exact };

  const partial = tasks.filter(t => {
    const n = normalizeTitle(t.text);
    return n.includes(q) || q.includes(n);
  });
  if (partial.length === 1) return { match: partial[0], ambiguous: [] };
  if (partial.length > 1) return { match: null, ambiguous: partial };

  return { match: null, ambiguous: [] };
}

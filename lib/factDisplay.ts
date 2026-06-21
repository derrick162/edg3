// T3-1 — pattern-category facts store a JSON-serialized PatternInsight in `statement`
// (see lib/factPatterns.ts: `factQueries.upsertFact(userId, 'pattern', JSON.stringify(p), …)`).
// Anywhere a fact's text is surfaced to the user (the "What Edge knows" memory tab), render the
// human-readable `summary` — never the raw JSON. A user who sees
// `{"type":"priority_drift","summary":"…","confidence":"high","sampleDays":5}` loses trust instantly.
// Every other category passes through unchanged. Client-safe: no imports, pure.

export function factDisplayStatement(category: string, statement: string): string {
  if (category === 'pattern') {
    try {
      const parsed = JSON.parse(statement) as { summary?: unknown };
      if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
        return parsed.summary;
      }
    } catch {
      // Not JSON (manually edited or legacy row) — fall through to the raw statement.
    }
  }
  return statement;
}

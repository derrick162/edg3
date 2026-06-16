import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { factQueries, calendarQueries } from '@/lib/db';
import { getRecentEmailSignal } from '@/lib/gmail';
import { extractAndUpsertFactsFromEmail } from '@/lib/facts';

// Trigger threshold: if fewer than this many facts, trigger an extraction pass on home load.
const THIN_FACTS_THRESHOLD = 10;

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('learned', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const allFacts = factQueries.getAll(user.id);
  const totalFacts = allFacts.length;

  // Facts learned or updated in the last 7 days — these are the "aha" payload.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recentFacts  = allFacts.filter(f => (f.learned_at ?? '').slice(0, 10) >= sevenDaysAgo);

  // Trigger a background extraction pass when context is thin + calendar is connected.
  // Fire-and-forget: we don't block the response on this.
  if (totalFacts < THIN_FACTS_THRESHOLD) {
    const calToken = calendarQueries.get(user.id);
    if (calToken) {
      getRecentEmailSignal(user.id, { days: 14, max: 20 })
        .then(emailSignal => {
          if (emailSignal && !emailSignal.scopeMissing && emailSignal.items.length > 0) {
            return extractAndUpsertFactsFromEmail(user.id, emailSignal, user.name ?? undefined);
          }
        })
        .catch(() => {});
    }
  }

  return NextResponse.json({
    recentFacts,
    totalFacts,
    isFresh: recentFacts.length > 0,
    // Hint for Design: show the "here's what I just learned" panel when isFresh is true.
  });
}

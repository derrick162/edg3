import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  hasWhoopConnected,
  getLatestRecovery,
  getLastSleep,
  getRecentStrain,
  getRecoveryHistory,
} from '@/lib/whoop';

/**
 * Dashboard recovery card data. Returns today's recovery score + tier, last sleep,
 * recent strain, and up to 14 days of recovery history for the sparkline.
 * Every fetch is independently guarded so a single Whoop failure degrades the card
 * (shows what it can) instead of failing the whole request.
 */
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!hasWhoopConnected(user.id)) {
    return NextResponse.json({ connected: false });
  }

  const [rec, slp, str, hist] = await Promise.all([
    getLatestRecovery(user.id).catch(() => null),
    getLastSleep(user.id).catch(() => null),
    getRecentStrain(user.id).catch(() => null),
    getRecoveryHistory(user.id, 14).catch(() => []),
  ]);

  const score = rec ? rec.recoveryScore : null;
  const tier =
    score === null ? null : score >= 67 ? 'high' : score >= 34 ? 'medium' : 'low';

  const sleepScore = slp ? slp.performancePct : null;
  const sleepTier = sleepScore !== null
    ? (sleepScore >= 75 ? 'high' : sleepScore >= 50 ? 'medium' : 'low')
    : null;

  return NextResponse.json({
    connected: true,
    recoveryScore: score,
    tier,
    sleepHours: slp ? Math.round((slp.durationMs / 3600000) * 10) / 10 : null,
    sleepScore,
    sleepTier,
    strain: str ? str.strain : null,
    history: hist.map(h => ({ date: h.date, score: h.recoveryScore })),
  });
}

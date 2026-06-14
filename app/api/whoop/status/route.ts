import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasWhoopConnected, getLatestRecovery, getLastSleep, getRecentStrain } from '@/lib/whoop';

function recoveryTier(score: number): 'green' | 'yellow' | 'red' {
  return score >= 67 ? 'green' : score >= 34 ? 'yellow' : 'red';
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const connected = hasWhoopConnected(user.id);
  if (!connected) return NextResponse.json({ connected: false, recovery: null, sleep: null, strain: null });

  const [recoveryRaw, sleepRaw, strainRaw] = await Promise.all([
    getLatestRecovery(user.id).catch(() => null),
    getLastSleep(user.id).catch(() => null),
    getRecentStrain(user.id).catch(() => null),
  ]);

  return NextResponse.json({
    connected: true,
    recovery: recoveryRaw ? { score: recoveryRaw.recoveryScore, tier: recoveryTier(recoveryRaw.recoveryScore) } : null,
    sleep:    sleepRaw    ? { durationMs: sleepRaw.durationMs } : null,
    strain:   strainRaw   ? { strain: strainRaw.strain }        : null,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { briefingQueries, userQueries } from '@/lib/db';
import { checkAdminSecretAuth } from '@/lib/adminAuth';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  const rl = checkRateLimit('adminApi', getClientIP(req));
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);
  if (!checkAdminSecretAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email param required' }, { status: 400 });

  const user = userQueries.findByEmail(email);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const briefing = briefingQueries.getLatest(user.id);
  if (!briefing) return NextResponse.json({ error: 'No briefings found' }, { status: 404 });

  return NextResponse.json({ briefing });
}

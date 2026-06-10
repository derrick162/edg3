import { NextRequest, NextResponse } from 'next/server';
import { vapiAuthLogQueries } from '@/lib/db';

function checkAdminAuth(req: NextRequest): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const cookie = req.cookies.get('edg3_admin');
  return !!(adminPassword && cookie && cookie.value === adminPassword);
}

// Admin monitoring for Vapi webhook secret status (#2).
// Use this during the 24-hour fail-open window to confirm Vapi is sending the right secret
// before flipping VAPI_SECRET_ENFORCE=true.
//
// Reports:
//   enforceMode  — current enforcement state (env var VAPI_SECRET_ENFORCE)
//   secretSet    — whether VAPI_SERVER_SECRET is configured
//   mismatches24h — count of mismatch-allowed events in the last 24 hours
//   recent        — last 50 auth events (mismatches only — accepted calls not logged)
//
// A healthy pre-enforce state: secretSet=true, enforceMode=false, mismatches24h=0.
// Ready to enforce: mismatches24h stays 0 for 24h after deploying VAPI_SERVER_SECRET.
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enforceMode = process.env.VAPI_SECRET_ENFORCE === 'true';
  const secretSet = !!process.env.VAPI_SERVER_SECRET;
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const mismatches24h = vapiAuthLogQueries.mismatchCount(sinceMs);
  const recent = vapiAuthLogQueries.recent(50);

  return NextResponse.json({
    enforceMode,
    secretSet,
    mismatches24h,
    readyToEnforce: secretSet && mismatches24h === 0,
    recent,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/adminAuth';
import { runHealthChecks } from '@/lib/healthCheck';

// GET /api/admin/health — structured readiness check.
// Returns HTTP 200 (ok/degraded) or 503 (critical) so monitoring can alert on it.
//
// status: 'ok'       — all checks pass
// status: 'degraded' — non-critical checks failing (replication, Vapi enforcement)
// status: 'critical' — critical checks failing (encryption, JWT secret, DB)
//
// Run after every Railway deploy to confirm prod is properly configured.
// Reference: LAUNCH.md §3 "Encryption ops" and §10 "Restore drill".
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const report = runHealthChecks();

  if (report.status === 'critical' || report.status === 'degraded') {
    const failedChecks = Object.entries(report.checks)
      .filter(([, c]) => !c.ok)
      .map(([k]) => k);
    console.warn('[health] Check(s) failing:', failedChecks.join(', '));
  }

  const httpStatus = report.status === 'critical' ? 503 : 200;
  return NextResponse.json(report, { status: httpStatus });
}

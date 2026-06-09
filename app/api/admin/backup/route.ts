import { NextRequest, NextResponse } from 'next/server';
import { createBackup, listBackups } from '@/lib/backup';
import { encryptionEnabled } from '@/lib/crypto';

function checkAdminAuth(req: NextRequest): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const cookie = req.cookies.get('edg3_admin');
  return !!(adminPassword && cookie && cookie.value === adminPassword);
}

// List existing snapshots + whether at-rest encryption is active.
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ backups: listBackups(), encryptionEnabled: encryptionEnabled() });
}

// Take a fresh snapshot now.
export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const info = await createBackup();
    return NextResponse.json({ success: true, backup: info });
  } catch (err) {
    console.error('[admin/backup] Failed:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

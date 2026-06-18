import { NextRequest, NextResponse } from 'next/server';
import { getSession, clearSessionCookie } from '@/lib/auth';
import { deleteUserData } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const CONFIRM_PHRASE = 'delete my account';

// Permanently deletes the authenticated user's account and all associated data.
// Requires { "confirm": "delete my account" } in the request body — an explicit
// contract so Core's UI must collect an intentional confirmation before calling this.
export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('accountDelete', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  if (!body || typeof body !== 'object' || (body as Record<string, unknown>)['confirm'] !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Missing confirmation. Send { "confirm": "${CONFIRM_PHRASE}" } to proceed.` },
      { status: 400 },
    );
  }

  try {
    // Deletes all user-scoped tables (leaf-first, FK-safe) then the users row, in a
    // single transaction. Source of truth for the table list: USER_SCOPED_DELETE_ORDER
    // in lib/db.ts — guarded against drift by app/api/account/account.test.ts.
    deleteUserData(user.id);

    // Clear the session cookie — the user no longer exists.
    const response = NextResponse.json({ success: true });
    response.cookies.set(clearSessionCookie());
    return response;
  } catch (err) {
    console.error('Account deletion error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getSession, clearSessionCookie } from '@/lib/auth';
import { userQueries } from '@/lib/db';

export async function POST() {
  const user = await getSession();
  if (user) {
    // Increment session_version so this user's current JWT is immediately invalidated.
    // This means a stolen token can no longer be used once the user logs out.
    userQueries.incrementSessionVersion(user.id);
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(clearSessionCookie());
  return response;
}

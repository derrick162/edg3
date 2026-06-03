import { NextRequest, NextResponse } from 'next/server';
import { userQueries } from '@/lib/db';
import { hashPassword, createToken, setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, name, password } = await req.json();

    if (!email || !name || !password) {
      return NextResponse.json({ error: 'All fields required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const existing = userQueries.findByEmail(email);
    if (existing) {
      return NextResponse.json({ error: 'Account already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const result = userQueries.create(email, name, passwordHash) as any;
    const token = createToken(result.lastInsertRowid);

    const response = NextResponse.json({ success: true });
    response.cookies.set(setSessionCookie(token));
    return response;
  } catch (err) {
    console.error('Signup error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

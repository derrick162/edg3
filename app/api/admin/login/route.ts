import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword || password !== adminPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set('edg3_admin', adminPassword, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

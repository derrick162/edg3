import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { recommendFocusAreas } from '@/lib/focusRecommendation';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const recommendation = await recommendFocusAreas(user.id);
  return NextResponse.json(recommendation);
}

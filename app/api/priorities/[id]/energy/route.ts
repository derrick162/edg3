import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { priorityQueries } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: { energy_cost?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const validCosts = ['high', 'medium', 'low', null] as const;
  const cost = body.energy_cost === undefined ? undefined : body.energy_cost;
  if (cost !== undefined && !validCosts.includes(cost as typeof validCosts[number])) {
    return NextResponse.json({ error: 'energy_cost must be high, medium, low, or null' }, { status: 400 });
  }

  priorityQueries.setEnergyCost(user.id, id, (cost ?? null) as 'high' | 'medium' | 'low' | null);
  return NextResponse.json({ success: true });
}

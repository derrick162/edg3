import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { supportMessageQueries } from '@/lib/db';

const VALID_TYPES = ['feedback', 'question', 'issue'] as const;
type SupportType = typeof VALID_TYPES[number];

// POST /api/support
// Body: { type: 'feedback' | 'question' | 'issue', message: string }
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('support', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const { type, message } = body as { type?: unknown; message?: unknown };

  if (!VALID_TYPES.includes(type as SupportType)) {
    return NextResponse.json({ error: 'type must be feedback, question, or issue' }, { status: 400 });
  }
  if (typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (message.trim().length > 2000) {
    return NextResponse.json({ error: 'message too long (max 2000 chars)' }, { status: 400 });
  }

  supportMessageQueries.insert(user.id, type as SupportType, message.trim());

  console.log(`[support] New ${type} from user ${user.id}: ${message.slice(0, 80)}…`);

  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { extractGmailAccountContacts } from '@/lib/gmail';
import { factQueries } from '@/lib/db';

const MAX_CONTACTS = 30;

// POST /api/auth/google/gmail/ingest
// Background job triggered after a Gmail account is linked.
// Reads recent email headers from the secondary Gmail account and upserts
// the unique senders as People facts so Edge learns who the user communicates with.
// Only header metadata (From address) is read — no message bodies are accessed.
export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const contacts = await extractGmailAccountContacts(user.id, { days: 60, max: 50 });

    let factsAdded = 0;
    for (const c of contacts.slice(0, MAX_CONTACTS)) {
      const displayName = c.name || c.email;
      const statement = c.name
        ? `Emails with ${c.name} (${c.email})`
        : `Emails with ${c.email}`;
      factQueries.upsertFact(user.id, 'people', statement, displayName, 'low');
      factsAdded++;
    }

    return NextResponse.json({ contactsFound: contacts.length, factsAdded });
  } catch (err) {
    console.error('[gmail ingest]', err);
    return NextResponse.json({ error: 'Ingestion failed' }, { status: 500 });
  }
}

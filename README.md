# EDG3 — Your AI Chief of Staff

EDG3 calls you every morning with a personalized 3-minute strategic briefing. Not a productivity app. A proactive AI advisor that knows your goals, reads your calendar, and tells you what actually deserves your attention today.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in your API keys (see below)

# 3. Run dev server
npm run dev
```

Open http://localhost:3000

## Required API Keys

### Anthropic (Claude) — Required
Get your key at https://console.anthropic.com  
Set `ANTHROPIC_API_KEY` in `.env.local`

### Vapi — Required for voice calls
Get your key at https://vapi.ai  
Set `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`

**Vapi setup:**
1. Create an account at vapi.ai
2. Buy or provision a phone number → copy the Phone Number ID
3. (Optional) Create an Assistant → copy the Assistant ID
4. Set your webhook URL to: `https://your-domain.com/api/vapi/webhook`

### Google Calendar — Optional
1. Go to https://console.cloud.google.com
2. Create a project → Enable **Google Calendar API**
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI: `http://localhost:3000/api/calendar/callback`
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

## How It Works

### User Flow
1. **Sign up** → paste a ChatGPT-generated profile summary
2. **Connect Google Calendar** (optional)
3. **Set weekly priorities** (top 3 things that matter this week)
4. **Schedule your call time** + phone number
5. **EDG3 calls you every morning** at that time

### Daily Briefing
Each morning EDG3 generates a briefing using Claude that includes:
- Greeting referencing your history
- Today's calendar snapshot
- Alignment check (are your priorities reflected in your schedule?)
- Top 3 leverage actions for today
- Pattern recognition from memory
- One calendar block recommendation
- Closing question: *"What's the most important thing I should know before tomorrow's briefing?"*

### Memory System
User responses are transcribed, analyzed, and stored. EDG3 accumulates:
- Your profile summary
- Weekly priorities
- Daily call transcripts
- Extracted insights
- Calendar notes

## Project Structure

```
app/
  page.tsx              # Landing page
  signup/               # Auth
  login/
  onboarding/           # 4-step setup flow
  dashboard/            # Main interface
  api/
    auth/               # signup, login, logout, me
    onboarding/         # profile, priorities, call-time
    briefing/           # generate, call, history
    calendar/           # connect, OAuth callback
    memory/             # memory retrieval
    vapi/webhook/       # call status + transcript ingestion

lib/
  db.ts                 # SQLite schema + query helpers
  auth.ts               # JWT + bcrypt
  briefing.ts           # Claude briefing generation
  calendar.ts           # Google Calendar OAuth + event fetching
  vapi.ts               # Vapi outbound call API
  scheduler.ts          # node-cron daily call scheduler

instrumentation.ts      # Starts scheduler on server boot
data/edg3.db            # SQLite database (auto-created)
```

## Dashboard Features

- **Preview briefing** — generate and read today's briefing without a call
- **Call me now** — trigger an immediate Vapi call
- **Briefing history** — view all past briefings and transcripts
- **Priorities** — view this week's top 3
- **Memory bank** — see everything EDG3 has stored about you

## Tech Stack

- **Next.js 16** (App Router)
- **SQLite** via better-sqlite3 (zero-config local database)
- **Claude** (claude-sonnet-4-6) for briefing generation and insight extraction
- **Vapi** for outbound voice calls
- **Google Calendar API** for schedule context
- **node-cron** for the daily call scheduler
- **Tailwind CSS** for styling


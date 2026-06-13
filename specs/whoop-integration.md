# Spec: Whoop integration (health-aware briefings)

> **Status:** Captured / scoped — **NOT yet greenlit to build.** Queue AFTER the current
> real-call fix batch (consolidation + grounded/decisive prompt cluster) and ideally as an
> early POST-validation feature. Net-new scope — must not jump ahead of launch gates
> (Google verification, Twilio) or the open core-loop fixes.
> **Origin:** User (Derrick) has a Whoop, 2026-06-11. Chosen over Apple Health because Apple
> Health has NO cloud API (on-device only → needs a native iOS app). Whoop has a real
> server-side OAuth API → connects like Google, no mobile app needed.

## The use case — a health-aware chief of staff
Edge factors the user's physical state into the morning briefing and recommendations:
- "Recovery's at 34% today — push the hard stuff to tomorrow, protect your morning."
- "You slept 5h12m — I kept your morning light; want me to move the 8am?"
- "You've strained hard 4 days straight — block a real rest window."
This is differentiated: a CoS that knows how you're *actually doing*, not just your calendar.

## Why Whoop (vs Apple Health)
| | Apple Health | **Whoop (chosen)** |
|---|---|---|
| Data access | On-device only, NO cloud API | **Cloud OAuth API** (developer.whoop.com) |
| Requires native app | YES (HealthKit) | **No** — server-side OAuth, like Google |
| Lift | Months (new platform) | ~2–3 days (one OAuth integration) |

## Architecture
1. **OAuth connect** — "Connect Whoop" button → Whoop OAuth 2.0 (authorize → callback → store tokens). Same shape as the Google calendar connect flow.
   - Authorize: `https://api.prod.whoop.com/oauth/oauth2/auth` · Token: `https://api.prod.whoop.com/oauth/oauth2/token`
   - Scopes: `read:recovery read:sleep read:cycles read:workout read:profile offline` (`offline` = refresh token). ⚠️ Verify exact scope names + v1-vs-v2 endpoints against current developer.whoop.com docs before building.
2. **Token storage** — encrypted at rest (reuse `lib/crypto.ts`, same as calendar/Gmail tokens). New `whoop_tokens` table (or column set), with refresh handling.
3. **Fetch primitive** — `lib/whoop.ts`: `getLatestRecovery(userId)`, `getLastSleep(userId)`, `getRecentStrain(userId)` → returns recovery %, sleep duration/quality, day strain. Guarded, read-only, refresh-aware.
4. **Briefing integration** — inject today's recovery/sleep/strain into `lib/briefing.ts` as structured facts ("RECOVERY: 34% · SLEEP: 5h12m · STRAIN(7d avg): high"). Prompt: factor it into the briefing's opener + pacing recommendations, honestly (only state real numbers; degrade silently if not connected / fetch fails — never block the briefing).
5. **Connect UI** — "Connect Whoop" in the dashboard (sidebar/settings), with connected/disconnected state, mirroring the Google connect controls.

## Lane split
- **🔒 Security** — Whoop OAuth (authorize + callback routes under `app/api/auth/whoop/**` or `app/api/whoop/**`), `WHOOP_CLIENT_SECRET`, encrypted token storage + refresh, and the guarded fetch primitive (`lib/whoop.ts`). Auth/secrets/external-access = Security's domain (mirrors the Gmail primitive split).
- **🛠️ Core** — the "Connect Whoop" dashboard UI + the briefing integration (inject recovery/sleep/strain) + prompt guidance for health-aware briefings.
- **⚠️ Shared** — `lib/db.ts` (new whoop_tokens table — additive), `lib/briefing.ts` (Core).

## Trust & privacy
- Health data is **sensitive PII** — encrypt tokens + any cached metrics at rest (`lib/crypto.ts`). Pull only what the briefing needs. Honest: never invent a recovery/sleep number; if not connected or the fetch fails, just omit the health section (degrade silently, never block the briefing).
- Whoop API has rate limits — cache the daily pull; don't hammer per request.

## External prerequisite (user — can start NOW, in parallel)
Create a Whoop developer app at **developer.whoop.com** → get `CLIENT_ID` + `CLIENT_SECRET`, set the redirect URI to our callback (e.g. `https://<app>/api/whoop/callback`), and we set `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` on Railway. (Same kind of setup as Google OAuth / the Vapi tools.)

## Sequencing & effort
- **Gate:** after the current fix batch lands + the core loop is validated. Net-new scope — do NOT let it displace the launch gates (verification, Twilio) or the open consolidation/grounded fixes.
- **Effort:** ~2–3 dev-days once the Whoop dev-app credentials exist. The dev-app creation (user) is the only external lead-time item — hours, not weeks.
- Strong, delightful, low-risk post-validation feature — but it's a *want*, not a launch *need*.

# State of Edge — What We've Built + The Trust Roadmap
_June 2026. Exec-readable. Sources: lane changelogs, specs, Status Board. Nothing invented._

---

## Part 1 — What We've Built

### 1. Morning Voice Call + Briefing

The foundation. Edge calls the user at a configured time (Mon–Fri). The call is a live AI conversation via Vapi, not a recording. What happens on a call:

- **Opens with the Edge Score** — a 0–100 readout of how set up the user is for a focused, energized day, with a plain-English diagnosis
- **Reads today's calendar** — surfacing what needs attention, what's misaligned, what's overloaded
- **Proposes changes** — named, specific calendar actions (create a block, move a meeting, delete a duplicate)
- **Executes on approval** — creates, moves, or deletes events in Google Calendar directly; never acts without a "yes"
- **Acknowledges yesterday's commitments** — opens with an accountability line when the user had incomplete tasks from the day before

The call also handles outbound actions: drafting emails, checking for replies, coloring the calendar by energy level, looking up events, cleaning up duplicates.

**Call quality features shipped:**
- Graceful hold messages (idle silences don't hang up)
- `firstName` personalization — Edge uses the user's first name, not full name
- Honest failure language — Edge never says "I can't do that" without offering an alternative
- Working hours awareness — never suggests evening or weekend work unless the user has stated those hours
- No jargon — no tool names, no internal mechanics, no "the system"

---

### 2. Focus Recommendation ("Edge Tells You Your Focus")

The most differentiating feature in the product. Instead of asking an overwhelmed user to declare their priorities, Edge analyzes their data and recommends them.

**What it does:**
- Synthesizes past calendar history, accumulated call facts/memories, Whoop energy data, and Gmail inbox signals
- Runs one LLM call → produces top 3 focus area proposals, each with a one-line rationale
- User confirms or tweaks in one breath; confirmed areas write to the priorities store
- **Fires on every briefing** — not just when no priorities exist (bug fixed June 15)

**The priority hierarchy (shipped):**
- Overarching anchors (stable, rarely change) — e.g. "extend runway," "get to 130 lbs"
- Weekly tactics (derived sub-goals under anchors)
- Daily focus areas (recommended each morning, modulated by today's energy + calendar)

**Email signal (shipped June 15):**
- `getRecentEmailSignal` fetches recent inbox thread metadata (From/Subject/snippet only — no bodies)
- `isUrgentEmail` flags financial, legal, and collection threads
- Urgent threads get `INBOX PRIORITY WEIGHTING` — ranked #1 in the focus proposal above any calendar block
- Degrades gracefully: no Gmail scope → prompt unchanged, no error shown

---

### 3. The Edge Score (4 components)

A single 0–100 number that tells the user how set up they are to perform. Computed daily and before every call.

| Component | Weight | What it measures | Source |
|---|---|---|---|
| **Focus** | 30% | % of non-routine committed time aligned to the 3 focus areas | Calendar + alignment engine (`lib/alignment.ts`) |
| **Energy** | 30% | Whoop sleep + recovery trailing ~7 days (60/40 weighted); "calibrating" when no data | Whoop API or self-reported |
| **Clarity** | 20% | How well Edge knows the user: connected sources + accumulated facts + call count | DB: facts, briefings, connected integrations |
| **Momentum** | 20% | Consistency of showing up: completed calls + confirmed focus plans (trailing 7–14d) | DB: briefings, daily_focus |

**Correctness fixes shipped (June 15):**
- Focus Score no longer uses a fixed 45h/week denominator — now uses ratio × coverage formula so a focused 18–25h week scores ~70–85, not ~40
- Routine events (gym, meals, walks) excluded from the committed-hours denominator — they were dragging down the score
- Energy Score no longer defaults to fake 100/70 on empty data — shows `calibrating: 50` instead
- Score is recalculated and visibly updates on the dashboard after the user confirms their focus (the "spark" moment)
- Priorities sync to Memory — confirming focus areas writes them as `category='goal'` facts so Edge references them on calls

---

### 4. The Hero Loop (Diagnose → Propose → Apply → Re-score)

The product's magic moment. The full loop:

1. **Diagnose** — Edge identifies concrete problems from data already computed: misaligned focus areas, hygiene flags (3 back-to-back meetings, no deep work block), low-recovery over-scheduling, urgent open loops
2. **Propose** — generates a specific reshaped day (named blocks + times), shown as a before/after
3. **Apply** — one button executes the whole plan atomically via `/api/day-plan/confirm`; each action is individually undoable; the whole plan is undoable as a unit
4. **Re-score** — Edge Score refetched and updated immediately; the score visibly climbs

**Infrastructure shipped:**
- `/api/day-plan` (GET) — builds today's plan, estimates score before/after
- `/api/day-plan/confirm` (POST) — executes creates + moves atomically, records undo group
- `DayPlanCard` — dashboard card showing the diagnosis and Apply button
- **S3 security hardening (June 17):** idempotency (double-click safely rejected), undo grouping bug fixed (planId now passed), execution tracking written, rate limit, authz (planId user-scoped)

**In progress (Ticket H):** deepening the diagnosis — currently only proposes a focus block; being extended to use hygiene flags, recovery tier, alignment gaps, and open loops so the card always has something real to say.

---

### 5. Whoop / Energy Integration

- Full OAuth flow: connect, callback, auto-refresh, disconnect (with RFC 7009 token revocation)
- Fetches: `getLatestRecovery`, `getLastSleep`, `getRecentStrain`
- **Whoop Trends (V3):** `computeWhoopTrends` — detects `RECOVERY_DECLINING_3D`, `RECOVERY_LOW_STREAK`, `SLEEP_DEBT`, `HIGH_STRAIN_STREAK`; injected into briefing
- **Proactive recovery defense:** `detectRecoveryDrop` fires on red tier (≤33%) or sharp drop (≥20pt below 7-day avg); identifies heaviest deferrable block and offers to move or shrink it
- **Correlations:** `getPastCalendarDays` fetches 14 days of calendar; cross-references with recovery history to detect patterns (e.g. meetings past 7pm → lower next-day recovery); only fires with ≥10 paired days of data
- **Energy color-coding:** `colorEventsByEnergy` Vapi tool — classifies today's events by demand, maps to Google Calendar colorIds (sage = low, banana/tangerine = medium, blueberry/tomato = high depending on recovery)
- **Dashboard:** RecoveryCard component (score, tier, sleep, strain, sparkline), sidebar Whoop status with recovery/sleep/strain inline

---

### 6. Gmail / Email Intelligence

- Gmail OAuth (compose + readonly scopes) via `lib/google-auth.ts`
- **Email drafting:** `createDraft` only — `messages.send` never called; user reviews in Gmail Drafts
- **Reply tracking:** `checkOutreachReplies` — reads only threads Edge originated (`watched_threads` table); distinguished from "no scope" vs "no replies" (never silently reports empty on scope-missing)
- **Focus signal:** inbox metadata scan (headers + snippet only, `format:'metadata'`, no bodies stored); `isUrgentEmail` flags financial/legal/collection threads; injected into focus recommendation engine
- **`draftEmail` Vapi tool:** live; parameters include recipients, subject, ask, availability, date range
- **`checkReplies` Vapi tool:** live mid-call reply check

---

### 7. Calendar Management (the full CRUD surface)

Every calendar operation a user might need, voice-accessible:

| Operation | Tool | Notable behaviors |
|---|---|---|
| Create event | `createEvent` | Supports location, description, all-day, multi-day |
| Move event | `moveEvent` | Handles recurring (single/all), organizer check (can't move others' events — drafts reschedule email instead) |
| Delete event | `deleteEvent` | Read-only calendar check; honest message if not owner |
| Edit event | `editEvent` | Read-only check |
| Batch delete | `cleanupEvents` | Single confirm-token for a whole batch; resolves by exact datetime |
| Dedup | `cleanupDuplicates` | Scans a date window, keeps earliest-created, removes duplicates |
| Color by energy | `colorEventsByEnergy` | Batch-patches Google Calendar colorIds |
| Research event | `researchToEvent` | Searches for event details; stores in description; retry on NORESULTS |

**Safeguards:** read-only calendar detection, organizer check before patch, undo logging for every mutation, disambiguation flow for ambiguous event titles.

---

### 8. Compounding Memory

Edge remembers everything the user tells it across calls.

- **Structured facts** (`lib/db.ts:factQueries`) — categorized by Goals / Projects / People / Preferences / Facts; entity + statement + source
- **Priority sync** — confirming focus areas writes them as `category='goal'` facts; visible in "What Edge knows"
- **Call memories** — raw notes from each briefing, paginated
- **"What Edge knows" tab** — full transparency into stored facts + categories; provenance stamps ("learned Jun 14")
- **Open Loops** — commitments mentioned on calls that haven't been closed; surfaced in briefings and the hero loop diagnosis

---

### 9. Notifications

- `lib/notifications.ts` — `score_change`, `fact_learned`, `activity` producers
- `existsToday` deduplication — no repeated notifications for the same event in a day
- Notification center on dashboard — populated with real items (June 16)
- `/api/notifications` — user-scoped, with `markRead`

---

### 10. Security + Trust Infrastructure

- **AES-256-GCM encryption at rest** — all OAuth tokens, call transcripts, Gmail draft metadata, Whoop health data, notification content
- **Self-service account deletion** — `DELETE /api/account` (requires explicit confirmation string); deletes all 19 tables in leaf-first order
- **Google OAuth token revocation** on disconnect — calls `getOAuthClient().revokeToken()`
- **Whoop token revocation** — RFC 7009 compliant POST to Whoop's revoke endpoint
- **Rate limiting** — IP-based, fixed-window counters on all auth and write-path routes
- **Audit logging** — every calendar mutation logged (`audit_log`: action, args, result, timestamp, user_id)
- **Activity tab** — user-visible log of everything Edge has done; per-row undo buttons
- **Idempotency** — `delete_confirm_tokens` table for calendar batch operations; `calendar_plan_executions` for hero loop apply
- **VAPI webhook HMAC** — `VAPI_SERVER_SECRET` enforcement (`VAPI_SECRET_ENFORCE=true`)
- **Admin routes** — all 14 verified with `checkAdminAuth` or `checkAdminSecretAuth`
- **Waitlist endpoint** — public write endpoint, rate-limited (5/hr), email-validated, no enumeration leak, backed up

---

### 11. Landing Page + Waitlist

- `app/page.tsx` — full landing page with hero, features, waitlist capture
- `/api/waitlist` — deduplicates on email, rate-limited, graceful on duplicate (returns 200, no leak)
- `waitlist` table in DB, included in backup set
- Content library: 12 education cards, GTM strategy, onboarding copy, FAQ, landing page copy, design partner outreach templates, beta launch playbook

---

## Part 2 — Where We Are vs. the Vision

**The vision (from `specs/energy-os.md`):**
> Each morning, Edge reads your energy, names your 3 focus areas for today, and reshapes today's calendar in real time. Within 5 minutes: "wow, my day just got a lot better."

**What's true today:**

| Capability | Status | Gap |
|---|---|---|
| Edge calls you every morning | ✅ Live | — |
| Edge reads your energy (Whoop) | ✅ Live | Whoop-only; self-report works but less seamless |
| Edge recommends your focus areas | ✅ Live | Still somewhat reactive — anchors proposed from history but not yet deeply derived from multi-month behavioral patterns |
| Edge proposes a reshaped day | ✅ Live (scaffold) | Diagnosis is shallow — currently only proposes a focus block; Ticket H deepens it |
| One "yes" reshapes the calendar | ✅ Live | Works; undo as a unit now fixed |
| Edge Score re-scores after apply | ✅ Live | Score projection was fake (+12 per action); Ticket H fixes to real re-derivation |
| "Wow, my day just got better" | 🟡 Partial | The loop works but the diagnosis lacks enough specificity to feel like a real chief of staff assessment; Ticket H is the fix |
| Proactive across the week (not just the call) | 🔴 Gap | Edge is still call-triggered; no proactive nudges between calls except notifications |

**The honest read:** the engine is real. The call works. The score is meaningful. The hero loop exists. The gap is **depth of diagnosis** — Edge needs to surface more specific, more surprising insights about the user's day (not just "you have no time on priority X" but "you have 3 meetings back-to-back and your recovery is red — this is how burnout starts"). That's Ticket H's job.

---

## Part 3 — The Trust Roadmap

A high-performer only hands their calendar, email, and energy data to an AI if they trust it. Trust isn't a feature — it's the prerequisite for everything. Here are the seven pillars, what we've already built, and what to build next.

---

### Pillar 1 — Show Your Work (Transparency + Receipts)

> Every action Edge takes should be visible, specific, and inspectable. Not "Edge read your inbox" — "Edge read 12 inbox threads: 3 marked urgent (CIBC, landlord, Rogers)."

**Already built:**
- Activity tab — every calendar mutation logged with before/after
- Audit log — timestamped record of all actions
- "What Edge knows" tab — full fact/memory transparency
- Undo per action + undo plan as a unit

**Next features:**
1. **Expandable receipts on every Activity item** — "Read 20 inbox threads" → expands to show sender names and subject lines of what was read (no bodies — just enough to verify). Currently the activity log shows action names with no detail.
2. **"Why did Edge propose this?"** — each hero loop proposal shows its exact reasoning: which data point triggered it ("recovery was 28 — red tier; heaviest block is 'Strategy planning' at 2pm — proposing to defer to tomorrow").
3. **Editable fact corrections** — user can tap any fact in "What Edge knows" and correct it (e.g. "Onsi" → "Ansi"). Currently facts are append-only with no correction path.
4. **"What Edge did today" summary** — end-of-day push notification or dashboard card: "Today Edge created 2 blocks, moved 1 meeting, read 8 inbox threads. [View details]"

---

### Pillar 2 — Accuracy You Can Verify

> Numbers and facts Edge states should be true and correctable. Users should never discover Edge was wrong about something and have no way to fix it.

**Already built:**
- Focus Score recalibrated (ratio × coverage; routine events excluded)
- Energy Score shows "calibrating" on thin data (never fakes 100)
- Score projection being fixed (Ticket H — real re-derivation, not +12 per action)
- Priorities sync to Memory so Edge uses confirmed facts, not stale ones

**Next features:**
1. **Fact correction UI** — any fact in "What Edge knows" can be edited or deleted by the user. Live example: a contact's name was misheard by STT; user has no way to fix it today. This is a trust-critical gap.
2. **Score explanation modal** — tap any Edge Score component → "here's exactly how this was calculated and what inputs were used." Full transparency, not a black box.
3. **Confidence signals** — when Edge makes a recommendation with thin data ("I only have 3 days of recovery history"), it says so. Never projects certainty it doesn't have.
4. **Contact name confirmation** — on first mention of a new person's name, Edge reads it back: "Just to make sure I have this right — is it Ansi or Onsi?" Stores the confirmed spelling.

---

### Pillar 3 — Reversibility + Control

> Anything Edge does can be undone. The user can always disconnect, delete, and take back control.

**Already built:**
- Per-action undo (every calendar mutation)
- Plan-level undo (undo the entire hero loop apply as one unit — fixed June 17)
- Account deletion (immediate, irreversible, all 19 tables)
- Google + Whoop disconnect with token revocation
- "Disconnect any time" messaging in onboarding + FAQ

**Next features:**
1. **Prominent undo on the dashboard** — the undo button for the most recent plan should be visible immediately after Apply, not buried in the Activity tab. "Undo the last reshape" as a surface-level affordance.
2. **Data export** — `GET /api/account/export` that returns all stored facts, briefings, and preferences as a downloadable JSON. Users should be able to take their data with them.
3. **Pause mode** — users can pause morning calls (vacation, break) without disconnecting. Edge doesn't forget anything; it just stops calling. Currently requires manual call time management.

---

### Pillar 4 — Honest Limits

> Edge says when it doesn't know, when data is missing, and when it can't help. It never fabricates.

**Already built:**
- "Calibrating" state on Edge Score components with thin data
- `GROUNDED & DECISIVE` prompt anchor in `lib/vapi.ts` — only state what data gives you, never fabricate
- `HONEST FAILURE` block — explains what failed and why, offers an alternative path
- `NEVER PUNT` instruction — no "do it yourself" dismissals; always owns the problem or offers a next step
- Recovery correlation only fires with ≥10 paired data days; degrades to null otherwise

**Next features:**
1. **Explicit data-gap disclosures in the briefing** — "I don't have your energy data today since Whoop didn't sync — I'll use your check-in from last call instead." Proactive, not silent.
2. **Confidence tier on focus proposals** — "High confidence" (strong calendar + call history) vs "Early read" (new user, thin data). Sets honest expectations.
3. **"What Edge doesn't know yet"** — a section in the dashboard complementing "What Edge knows" — prompts for gaps that would improve the score: "I don't have your peak energy window yet — tell me and your Energy score becomes more accurate."

---

### Pillar 5 — Predictability

> Edge's behavior and scores don't change without a real reason. The user can build a mental model of how Edge works.

**Already built:**
- Score flicker fix — scores no longer jump randomly between sessions
- Focus Score formula is deterministic (ratio × coverage) and documented
- Momentum computed from DB records, not session state
- Hero loop uses the same scoring path as the dashboard (being unified in Ticket H)

**Next features:**
1. **Score changelog** — "Your Focus score went from 68 → 74 today. Here's why: you confirmed your focus areas (+8 Momentum) and blocked 2h for 'extend runway'." Currently the score changes with no explanation of what moved it.
2. **Stable behavior on re-call** — if the user calls twice in one day, Edge should reference the first call, not re-analyze from scratch as if it never happened.
3. **Explicit score history sparkline** — 7-day Edge Score trend already computed; surface it on the dashboard so users can see their trajectory, not just today's number.

---

### Pillar 6 — Privacy You Can Feel

> Encryption and compliance are table stakes. "Privacy you can feel" means users understand what Edge sees, know it's protected, and can verify it.

**Already built:**
- AES-256-GCM encryption at rest on all tokens, transcripts, health data, draft metadata
- Email bodies never fetched (enforced via `format:'metadata'` API parameter)
- No email content stored — signal derived and discarded
- Audit log records inbox access (thread count only — no content)
- Privacy policy updated to reflect actual scopes (calendar write, Gmail reading for prioritization)
- FAQ privacy section — plain-language explanation of what's accessed and why
- Google verification + CASA prep spec complete; demo video shot-list ready

**Next features:**
1. **"What Edge can see" live panel** — a real-time view in dashboard Settings showing exactly what's currently accessible: "Calendar: ✅ connected, last read 8 min ago. Gmail: ✅ connected, last scanned yesterday. Whoop: ✅ connected, last synced 2h ago." Not a static privacy policy — a live readout.
2. **Inbox scan notification** — after each briefing that read inbox signals, a line in the Activity feed: "Read 12 inbox threads to inform your focus recommendation. [3 marked urgent: CIBC, Rogers, landlord]." Currently "Read 20 inbox threads" shows with no detail.
3. **Google verification completed** — unrestricted production use (currently limited to test users). This is the single biggest trust signal for new users: Google has reviewed and approved our use of restricted scopes.
4. **Twilio verified** — outbound calls from a recognized number, not an unknown carrier.

---

### Pillar 7 — Confirmation Before Consequence

> Edge confirms before any irreversible or high-stakes action. No surprises.

**Already built:**
- `confirmToken` gate for all batch delete operations
- Organizer check before moving other people's events — honest message + offer to draft reschedule
- Read-only calendar detection — clear explanation, not a confusing 403
- Hero loop: full before/after preview before Apply button is shown
- Idempotency on Apply — double-click safely rejected (S3)
- VAPI webhook HMAC — only Vapi can trigger tool calls (no spoofed actions)

**Next features:**
1. **"Undo window" toast after Apply** — immediately after the hero loop executes, a prominent "Undo this reshape" toast appears for 30 seconds. Most users won't need it, but its presence signals: "we know this was significant, here's the safety net."
2. **Email draft preview before creating** — when Edge drafts an email, return the draft body for the user to review on the call ("here's what I'd say — does that sound right?") before creating the Gmail draft.
3. **Recurring event scope confirmation** — when moving a recurring event, Edge always confirms scope ("just this one, or all future?") before patching. Currently in the prompt; should also be enforced at the API layer.

---

## Priority Shortlist — If We Build 3 Trust Things Next

These are the highest-leverage trust investments given where we are (pre-beta, first real users):

**1. Fact correction UI (Pillar 2 + Pillar 1)**
The "Onsi → Ansi" problem is a live bug and a trust-killer. Users discovering Edge has wrong information with no correction path will churn. This is small to build, high trust impact, and unblocks edge cases in every other memory feature.

**2. Expandable activity receipts with inbox detail (Pillar 1 + Pillar 6)**
"Read 20 inbox threads" appearing repeatedly in the Activity tab with no detail looks like surveillance, not helpfulness. Adding the sender/subject breakdown (no bodies) turns an opaque log entry into proof of relevance. One of the most common beta user questions will be "what did it actually look at?" — this answers it.

**3. Prominent undo after Apply + score changelog (Pillar 3 + Pillar 5)**
The hero loop is the product's biggest moment. Right now after Apply: the score changes silently and the undo is buried. A 30-second "Undo this reshape" toast + a one-line "score went from 64 → 71 — here's why" turns a black-box action into a legible, reversible, trustworthy one.

---

_Last updated: June 2026. Owner: CoS (Esther) + PM (Kevin). Route technical accuracy questions on Part 1 to PM. Route build prioritization to PM → engineering lanes._

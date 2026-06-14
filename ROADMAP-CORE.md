# 🛠️ EDG3 — Core Lane (features / product)

> Backlog for the **Edg3 Engineer (Core)** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `core` in
> `C:\Users\Derrick\edg3-core`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list. The PM routes new product feedback into the
> backlog below.

## Changelog
- **2026-06-14** — **Energy OS MVP — daily energy signal + priority cost tags + dashboard setter.**
  - **`lib/energy.ts`** (pure, 0 I/O): `EnergyLevel`, `EnergySignal`, `whoopTierToLevel(score)`,
    `deriveEnergySignal(log, whoopScore)` (precedence: stored override > stored manual > Whoop auto > null),
    `formatEnergyForBriefing(signal, priorities, firstName)` (ENERGY STATE + FOCUS-AREA ENERGY COSTS +
    RED DAY ACTION blocks), `formatEnergyForCall(signal, firstName)` (compact line or ask-early prompt).
    18 new tests in `lib/energy.test.ts`.
  - **`lib/db.ts`**: `energy_log` table (UNIQUE(user_id, date) ensures one row per day; upsert-on-conflict);
    `energyLogQueries.upsert()` + `.getToday()`. `energy_cost` column on `priorities` (migration-safe ALTER);
    `priorityQueries.setEnergyCost()`. `Priority.energy_cost` optional (new migration column may be absent).
    `EnergyLog` interface.
  - **`lib/briefing.ts`**: derives today's energy signal from stored log or Whoop recovery; calls
    `formatEnergyForBriefing` and injects ENERGY block into `userPrompt` between priorities and calendar.
    Fixed `{firstName}` placeholder — now passes real first name.
  - **`lib/vapi.ts`**: 11th `energyText` param in `initiateCall`; injected after WHOOP DATA section.
    `setEnergyLevel` tool guidance bullet (level red/yellow/green, source manual/override).
  - **`lib/scheduler.ts`**: `currentEnergyText(userId)` — derives signal from log or Whoop recovery;
    both `scheduleBriefingCall` and `scheduleOpenCall` pass it as the 11th arg to `initiateCall`.
  - **`app/api/energy/today/route.ts`** (new): `GET` returns today's energy signal (log or Whoop-derived);
    `POST` upserts a manual entry.
  - **`app/api/priorities/[id]/energy/route.ts`** (new): `PATCH` sets `energy_cost` on a priority.
  - **`app/api/vapi/tool-call/route.ts`**: `setEnergyLevel` handler — validates level/source, upserts to
    `energy_log`, returns spoken confirmation.
  - **Dashboard**: `energySignal` state; loaded via `/api/energy/today` in `loadData`. Sidebar energy
    quick-set card (Red / Yellow / Green buttons; active level highlighted; POST to `/api/energy/today`
    on click; source 'override' if Whoop was the prior source). Priorities tab: per-priority energy-cost
    badges (high/medium/low); click to set or toggle off; PATCH `/api/priorities/[id]/energy`.
  - 18 new tests. 534/534 green, tsc clean, next build clean.
  - ⚠️ **External step (PM):** Create `setEnergyLevel` tool in Vapi dashboard. Params: `level` (string, required — red/yellow/green), `source` (string, optional — manual/override). Paste UUID into `lib/vapi.ts` toolIds.
- **2026-06-13** — **Stronger Whoop recommendations — baseline-relative + composite signal (Priority 4).**
  - `buildBaselineContext(recovery, recoveryHistory, recentSleepMs, recentStrain)` pure helper
    added to `lib/briefing.ts`. Computes "today 45% · 7-day avg 63% · −18 pts" baseline line.
    Adds a COMPOSITE SIGNAL block when ≥2 signals compound (red recovery + sleep debt <6.5h avg +
    high strain >15 on Whoop's 0–21 scale). Frame is coaching grounded in numbers — never
    medical claims. Degrades to null when fewer than 3 history points.
  - Injected into `whoopContextBlock` in `generateDailyBriefing` as "BASELINE (use these numbers
    when coaching pacing...)" — placed after the tier line so the model can cite concrete delta
    in section 1 ("18 points below your weekly average") and tie pacing advice to the actual gap.
  - Sleep history sorted newest-first before slicing so the most recent 7 days are always used.
  - 8 new tests. 490/490 green, tsc clean, next build clean.
- **2026-06-13** — **Voice polish + call status + copy-transcript (Priorities 7, 3, 8).**
  - **P7 — Voice pronunciation avoid-list (prompt-only):** Added WORD CHOICE line to `lib/vapi.ts`
    system prompt. Instructs Edge to say "wrap up" not "wind up", "finish" not "wind down", and to
    avoid homographs ElevenLabs mispronounces. ~1 line addition to the NATURAL LANGUAGE cluster.
  - **P3 — Call status + report-missed-call:**
    - `GET /api/briefing/today-status` — queries today's briefings for the logged-in user (by
      `scheduled_for LIKE <today>%`), returns `{ status, scheduledFor }` or `{ status: 'none' }`.
    - `POST /api/briefing/retry-call` — guards against double-calling (409 if already completed
      or calling); calls `scheduleBriefingCall(userId)` which generates a fresh briefing + initiates
      Vapi call; returns `{ success, briefingId }`.
    - Dashboard sidebar: fetches today's status on load. Shows "✓ Call done for today" (green),
      "● In progress…" (accent), or "Missed today / Call failed" + "Call me now" button when
      status is missed/failed. Button fires retry endpoint; sidebar optimistically shows "Calling
      you now…" on success.
  - **P8 — Copy-transcript button:** In the expanded briefing detail (Briefings tab), the CALL
    TRANSCRIPT header row now has a "Copy" button. On click → `navigator.clipboard.writeText`
    with the full transcript text → "Copied ✓" for 2s then reverts. `copiedTranscriptId` state
    tracks which card has the active confirmation so multiple cards don't interfere.
  - 482/482 green, tsc clean, next build clean.
- **2026-06-13** — **Fact trustworthiness + profile-name fix (Priorities 1, 2).**
  - **P1 — Profile-name fix:** `extractFactsFromTranscript(transcript, userName?)` now injects the
    correct user name into the Haiku prompt so STT mis-spellings ("Derek" for "Derrick") are
    corrected at extraction time. `isSelfEntity(entity, userName)` secondary guard skips `person`
    facts about the user themselves. `extractAndUpsertFacts` updated to pass `user.name` from the
    webhook caller.
  - **P2 — Fact trustworthiness:** `confidence TEXT ('high'|'low')` and `source_briefing_id`
    columns added to `facts` table (migration-safe ALTERs). `upsertFact` accepts both; Haiku
    returns `"confidence":"low"` for STT-risky entities (unusual names, street addresses). Dashboard
    shows "⚠ verify" badge on low-confidence facts; "learned from your <date> call ↗" provenance
    link on facts with a source briefing.
  - 9 new tests. 482/482 green, tsc clean, next build clean.
- **2026-06-13** — **Call-time in prompt + location awareness + edit/delete facts.** (`75589c4`)
  - **Call-time in system prompt (addendum 1):** `initiateCall` gains a `callTime` 10th arg (default `''`).
    Injects `SCHEDULED CALL TIME: <HH:MM tz>` into the live-call prompt so Edge can answer "when do
    you call me?" directly without relying on the calendar block. Both briefing + open-call scheduler
    paths pass `user.call_time || ''`.
  - **Location awareness (addendum 2, prompt-only):** LOCATION AWARENESS bullet added to `lib/vapi.ts`.
    Edge calls `rememberPreference("CURRENT LOCATION: <address>")` when user says where they are, and
    `"NAMED PLACE: <alias> = <address>"` for place nicknames ("up north = 119 Scandia Lane"). "Near me"
    / "nearby" searches look up the stored CURRENT LOCATION fact rather than using freshly-transcribed
    speech (which STT commonly mishears). Always echoes address back before storing.
  - **Edit/delete facts (addendum 3):** `factQueries.updateFact(userId, id, statement, entity)` and
    `factQueries.deleteFact(userId, id)` added to `lib/db.ts` — both enforce `AND user_id = ?`.
    New `PATCH /api/memory/facts` and `DELETE /api/memory/facts` routes (401 unauth, 400 on missing
    fields). Dashboard Memory tab: per-fact ✏ (inline textarea → Save/Cancel) and × (inline confirm →
    Delete). Optimistic state update. CORRECTING MEMORIES prompt bullet: when user says Edge got
    something wrong → apologise, correct for this call, point to "What Edge knows" on dashboard.
  - 5 new tests (updateFact/deleteFact mock contract + user-scoping). 476/476 green, tsc clean, next build clean.
- **2026-06-13** — **Call-time reminder sync + research misheard-address retry.** (`8d25e4f`)
  - **T1 — Call-time change syncs calendar reminder:** `buildBriefingReminderBody` (pure, tested)
    and `resyncBriefingReminder(userId)` extracted to `lib/calendar.ts`. ONLY-IF-EXISTS: finds
    existing reminder masters and recreates them at the new time; never force-creates for users
    who skipped setup. Called fire-and-forget from the call-time route. `findBriefingReminderMasters`
    shared with the reminder POST route (no drift). 4 new tests.
  - **T2 — Research on garbled address retries:** `lib/vapi.ts` prompt extended: when a local
    business search returns no results, treat it as a likely-bad query (misheard address), re-confirm
    location + terms, and retry before reporting "nothing found." Never save a NORESULTS block.
  - 471/471 green, tsc clean, next build clean.
- **2026-06-10** — **QA bug batch — 5 bugs fixed** (3 commits `0390c63`→`dfc0bf2`). All from autonomous audit:
  - **Bug 1 [MEDIUM, data-destructive]** `moveEvent` silently converted timed events to all-day when model supplied only `newStartDate`. Root: `dateMove = isAllDay || !!newStartDate` fell into the date-only patch path for timed events. Fix: 3 explicit branches — (a) all-day → date patch, (b) timed + date-only input → new `timedEventDateMove()` that extracts wall-clock time via Intl and preserves duration, (c) full datetime → unchanged. `timedEventDateMove` added to `lib/time.ts` with 4 tests.
  - **Bug 2 [HIGH]** Outreach emails showed availability slots with no timezone label — recipients couldn't tell which timezone "2:00 PM" referred to. Fix: `buildOutreachBody()` now accepts `userTimezone` and derives a short abbreviation (e.g. "PDT") via Intl, inserting it into the slot header. Threaded through `composeOutreachEmail()` and the `draftEmail` handler in `route.ts`. 2 new tests.
  - **Bug 3 [LOW-MED]** `bookEventTimes` silently clamped late-evening + long-duration bookings to `23:59`, shortening meetings. Fix: roll end into the next calendar day via `nextDay()` instead of clamping. Updated 2 existing tests that had asserted the wrong behavior.
  - **Bug 4 [LOW]** `recipientsFromNotes()` could pick a non-name first line (e.g. "Best plumber in Austin") as the recipient name. Fix: prefer an explicit `Name:` line; validate fallback by rejecting URLs, email addresses, and lines longer than 80 chars. 5 new tests.
  - **Bug 5 [LOW]** (a) `generatePreviewBriefing` interpolated `user.call_time` (can be null) into the LLM prompt. Guarded with `?? '07:00'`. (b) Preview endpoint could return inconsistent text on concurrent first-loads. Fix: re-read from DB after `INSERT OR IGNORE` so the response always matches storage.
  172/172 tests, tsc clean, build clean.
- **2026-06-10** — **Day-1 preview briefing SHIPPED** (`d724556`) — activation "aha" on first dashboard load.
  - New `GET /api/briefing/preview`: checks for existing preview, generates if absent (one LLM call per user, never repeated), returns JSON `{ content }`.
  - New `generatePreviewBriefing(userId)` in `lib/briefing.ts`: priorities-first, calendar optional (degrades gracefully if not connected), ~200-word welcoming tone — distinct from the daily briefing format.
  - New `preview_briefings` table in `lib/db.ts` (additive — `UNIQUE on user_id`, `INSERT OR IGNORE` handles races). Claimed in Status Board before touching.
  - Dashboard (`app/dashboard/page.tsx`): triggers preview fetch once `onboarding_complete && briefings.length === 0`; shows a spinner ("Edg3 is putting together your preview…") while generating, then a labeled card "✦ HERE'S WHAT EDG3 ALREADY KNOWS ABOUT YOUR WEEK". Preview disappears once the user has real briefings. 160/160 tests, tsc clean, build clean.
- **2026-06-10** — **readCalendar response cap + prompt trim re-apply** (`tool-call/route.ts`,
  `lib/vapi.ts`). Two latency-hardening changes in one commit:
  - `readCalendar` now drops `status=cancelled` events (recurring-event expansions include them)
    and hard-caps at **25 active events** with a `(Showing first 25 of N…)` trailer. Fixes the
    late-call lag: each readCalendar call was growing the Vapi context by 50+ event lines; now
    bounded. Security's idempotency guards (`claimEventCreate`, `confirmToken`) fully preserved.
  - System prompt re-trimmed (~25% reduction) — Security's batch had reverted to the old verbose
    version (their branch was behind Core's `942a497`). Re-applied the trim with Security's new
    `confirmToken` delete-confirm language incorporated (model must pass back the server-issued
    token, not `confirmed:true`). 117/117 tests, tsc clean, build clean.
- **2026-06-10** — **Chief-of-Staff calendar API SHIPPED** (`app/api/admin/calendar/events/route.ts`,
  `lib/calendar.ts`). Two new admin endpoints guarded by `x-admin-secret`:
  - `GET /api/admin/calendar/events?email=...&days=7` — upcoming events for the next N days
    (1–90, default 7), returned as trimmed objects (id, title, start, end, allDay, description,
    location, status). Fetches all non-hidden calendars in parallel via new `getUpcomingEvents()`.
  - `POST /api/admin/calendar/events` — creates an event on the user's primary calendar.
    Body: `{ email, title, start, end, description?, timezone? }`. Validates ISO parse + end > start.
    Returns `{ success, eventId, title, start, end, timezone }`.
  No new Google scopes needed. 80/80 tests, tsc clean, build clean (52 routes).
- **2026-06-10** — **System-prompt trim + honest-failure guardrail** (`lib/vapi.ts`). Trimmed the
  static system prompt by ~25% (~300 tokens / call): collapsed the 7-line named-days block into a
  compact single-line format, merged 6 error-handling bullets into one `HONEST FAILURE` bullet,
  removed the redundant tool-name list (model knows tools from toolIds), tightened conditionals,
  scope, and personality text. Added a clearer honest-failure rule: "Never say 'done' unless the
  tool returned success. Never fabricate a result. A clear 'I couldn't do that' is always better
  than a false 'done.'" All critical behaviors preserved (all-day date range, confirm-delete,
  undo, timezone passthrough, NEVER INVENT FACTS, disambiguation, draftEmail draft-only).
  Caching finding: **Vapi does NOT expose Anthropic `cache_control`** — `systemPrompt` is a plain
  string with no `cacheControl`/`anthropicConfig` passthrough, so per-turn prompt caching is
  unavailable; trimming is the only lever. 80/80 tests, tsc clean, build clean.
- **2026-06-10** — **Deduplicated `recipientsFromNotes`** — removed the inline copy from the `draftEmail` handler in `app/api/vapi/tool-call/route.ts`; now imports the canonical, tested version from `lib/outreach`. tsc clean, 80/80 tests.
- **2026-06-10** — ★ **Recent Activity tab SHIPPED** — per-row undo feed in the dashboard.
  - New **Activity** tab (⏪) in the sidebar nav; shows the last 20 actions Edge took on the user's calendar, newest first.
  - Each row: action label (e.g. "created 'Team Meeting' on June 25"), relative timestamp, and an **↩ Undo** button that reverses that specific action in place.
  - Already-undone rows are shown greyed out (full audit trail — nothing hidden). Only one undo runs at a time to prevent race conditions.
  - API changes (all additive, backward-compatible):
    - `GET /api/undo?list=1` → returns `{ actions: [{id, label, undone, created_at}] }` for the feed.
    - `POST /api/undo` with `{ id: N }` → undoes that specific log entry (cross-user guarded); without `id` still undoes the latest (existing sidebar button unaffected).
    - `undoQueries.listRecent(userId, limit)` + `undoQueries.getById(userId, id)` added to `lib/db.ts` (Shared — claimed before editing; additive only).
  - The quick-undo button in the sidebar remains for the most recent action; the Activity tab is for browsing and selective undo of any past action.
  - Acceptance: user can open Activity tab and undo any individual Edge action without a voice call. ✅ tsc clean, 61/61 tests.
- **2026-06-09** — ★ **Email drafting SHIPPED (draft-only)** — `draftEmail` handler wired in
  `app/api/vapi/tool-call/route.ts` (Shared, claimed first; additive) + tool/system-prompt guidance in
  `lib/vapi.ts`. Flow: `emailableRecipients` (skip no-email contacts, report them) → `findFreeSlots` over a
  one-week window (default today→+6, or `startDate`/`endDate`) → `formatSlotsForEmail` → per recipient
  `composeOutreachEmail` (lib/outreach.ts) → Security's `createDraft(userId, {to, subject, body})`
  (lib/gmail.ts, guarded/draft-only) → `recordUndo` with one `deleteDraft` op per draft. Never sends.
  `GmailScopeError` → tells the user to reconnect Google (re-consent); `GmailRateLimitError` → reports the
  cap and keeps/undoes drafts already made. Returns "Drafted N emails in your Gmail — review and send."
  Verified green: tsc clean, 61/61 tests, eslint clean (only pre-existing `_e` warnings).
  - ⚠️ **External step (Vapi dashboard) — the model can't call `draftEmail` until its tool is created there.**
    Add a new tool named **`draftEmail`** with these params:
    - `recipients` — **array** of objects `{ name (string), email (string) }`. The people to email (from research results). Required.
    - `ask` — **string**. What to ask them, e.g. "when they can come by this week". Required.
    - `proposeAvailability` — **boolean**. Include the user's real open calendar slots in the email. Default true.
    - `startDate` — **string** (YYYY-MM-DD), optional. Start of the availability window. Defaults to today.
    - `endDate` — **string** (YYYY-MM-DD), optional. End of the availability window. Defaults to 6 days after start (this week).
    - `subject` — **string**, optional. Overrides the auto-generated subject.
    Then paste the tool's Vapi ID into the `toolIds` array in `lib/vapi.ts` (placeholder comment marks the spot).
- **2026-06-09** — Ownership-split fix (PM ruling, ROADMAP §3): both lanes had created `lib/gmail.ts`.
  Resolved — `lib/gmail.ts`/`lib/google-auth.ts` are 🔒 Security's (the Gmail access primitive +
  guarded `createDraft`); Core's **composition** lives in new `lib/outreach.ts`. Deleted my
  `lib/gmail.ts`/`lib/gmail.test.ts`; ported the composition helpers to `lib/outreach.ts`
  (`emailableRecipients`, `formatSlotsForEmail`, `buildOutreachBody`, `composeOutreachEmail` →
  `{recipient, subject, body}`) with unit tests in `lib/outreach.test.ts` (6 pure-helper tests). Dropped
  the Gmail primitives (`buildRawMessage`/`createGmailDraft`/`deleteGmailDraft`) — those are Security's;
  the future `draftEmail` handler will call Security's `createDraft` + `deleteDraft` undo op. Full suite
  39/39 green, tsc + eslint clean. Frees the `gmail.ts` filename so Security's foundation merges cleanly.
  - ⏳ **Still gated on 🔒 Security** (Gmail scope + `createDraft` + `deleteDraft` UndoOp on master).
    On the PM's "scope landed" signal: `git merge master`, claim `tool-call/route.ts` (Shared), wire
    `draftEmail`, merge. Then user adds `draftEmail` params to the Vapi dashboard. Remaining wiring steps
    documented in `lib/outreach.ts` header.
- **2026-06-09** — Shipped both **Now** tickets in one pass (`app/api/vapi/tool-call/route.ts` + `lib/vapi.ts`):
  - **Multi-day all-day + editable all-day.** `createEvent` all-day branch now takes an inclusive
    `endDate` and writes one spanning event (Google `end.date = nextDay(endDate)`) instead of forcing
    a per-day loop. `moveEvent` now re-dates all-day events via date-only `newStartDate`/`newEndDate`
    (auto-detected for any all-day target), so "make it just the 26th" / "extend it to the 30th" works;
    delete already worked. System prompt in `lib/vapi.ts` instructs the model to make ONE spanning
    event for a range and to use `moveEvent` date params to fix it.
  - **Research replaces, not piles up.** `researchToEvent` wraps findings in `--- Edge research ---`
    delimiters; each call strips the prior research block and writes only the latest, while preserving
    the user's own typed notes (`stripResearchBlock`).
  - ⚠️ **External step (Vapi dashboard, cannot be done from code):** the tool param schemas live in
    Vapi (referenced by `toolIds` in `lib/vapi.ts`), not the repo. Add `endDate` (string, date) to the
    **createEvent** tool and `newStartDate`/`newEndDate` (string, date) to the **moveEvent** tool so the
    model can pass them. Until then route.ts degrades safely (single-day all-day; re-date still works for
    detected all-day events via the existing datetime params sliced to a date).
  - 🤝 **Security coupling (#3 idempotency):** this rewrite makes the all-day path a *single* insert
    (was a model-driven multi-call loop), so it reduces — not increases — duplicate-on-retry surface.
    No dedupe added here (Security's lane). Sync before the `tool-call/route.ts` master merge.
- **2026-06-09** — Lane created (renamed from "Builder" → "Core"). Mandate set:
  ship new user-facing features for the Edg3 voice/calendar assistant. Backlog
  below is a **seed** — the PM refines it from user feedback.

---

## Mandate
Ship new **user-facing features** for the Edg3 voice + calendar assistant —
improving the dashboard, briefing, calendar, and onboarding experiences. Move
product value fast while staying inside the Core ownership lane (constitution
§3); hand anything touching auth/secrets/infra to the Security lane.

## How priorities are ranked
By user-visible value shipped per day, inside the Core-owned surface. The PM sets
priority from user feedback.

## Backlog (seed — PM refines from user feedback)
### Now
- [ ] **★★ Energy OS — MVP (the product's new center of gravity)** — _Derrick product direction, 2026-06-14._
  Make Edge run the calendar on the user's ENERGY. **Full vision + MVP: `specs/energy-os.md`.**
  MVP (cheap validation, works for ALL users not just Whoop):
  1. **Energy signal** {red/yellow/green} per day — auto from Whoop recovery (reuse tier mapping)
     OR manual (Edge asks "energy — red/yellow/green?" at call start + a dashboard quick-set).
     Additive `energy_log` table (coordinate 🔒 Security on schema).
  2. **Energy-cost tags** on focus areas/priorities (high/med/low) — dashboard control + learnable.
  3. **Energy-driven DAY recs + proactive moves** — if a HIGH-energy focus block sits on a RED day,
     proactively offer to move it to a better day → on yes, moveEvent. Builds on existing recovery
     pacing + energy-matching + alignment. (Overlaps Briefing V2 — coordinate; energy is the spine.)
  - Lanes: 🛠️ Core (signal+tags+logic+wiring), 🎨 Design (red/yellow/green logger + tag UI), 🔒 Security (energy_log schema).
  - After MVP: week-level optimization → energy forecasting → Oura (parked). Positioning shift → CoS.
- [ ] **★ Briefing V2 — proactive, goal-driven, relational** — _from Derrick's 10/10 call feedback, 2026-06-14._
  Make the morning briefing PROACTIVE (not report-and-react). **Full spec: `specs/briefing-v2-proactive.md`.**
  - **Quick prompt wins (do first, low risk):** recovery → motivating encouragement tied to the
    actual event + tonight's sleep; proactively offer to fill the first free slot with a stated
    priority and ACT on yes; offer choices among goals for free time; look ahead to TOMORROW; warmly
    engage personal events (e.g. "Dad's Birthday" → ask + offer help).
  - **Needs stored facts:** strain goal (Derrick's = ">10"); dinner/nutrition for the 130lb goal.
  - **★ Needs infra (highest trust):** remember + COMPLETE unfinished committed actions across calls
    (e.g. the gym move that failed repeatedly) — open the next call by finishing it. Coordinate with
    🔒 Security on the action/audit log.
- [ ] **★ Whoop V3 — Proactive recovery defense + correlations** — _PM + user decision, 2026-06-13. The "magic tier" of the Whoop integration; user explicitly queued it after V1/V2 shipped._
  - **Context:** V1 (recovery-aware pacing) and V2 (energy-matched blocking) are live. Security shipped the history primitives (`getRecoveryHistory` / `getSleepHistory` / `getStrainHistory`, 14-day, in `lib/whoop.ts`). The dashboard RecoveryCard is wired (`/api/whoop/recovery`, PM commit `bf35921`). This ticket builds the two things on top of that data.
  - **Part A — Proactive recovery defense (briefing + live).**
    - **Goal:** When recovery is RED (≤33%) **or drops sharply vs the recent baseline** (e.g. ≥20-pt drop from the trailing-7-day average), Edge *proactively* proposes lightening today — names the heaviest / most-deferrable block(s) and offers to move or shrink them. Edge offers → user confirms → Edge acts via the existing `moveEvent`/`deleteEvent`/`createEvent` tools. Never auto-edits without consent.
    - **Impl:** pure helper, e.g. `detectRecoveryDrop(today, history)` in `lib/whoop*`/`lib/briefing.ts` → returns `{ red | sharp_drop, deltaVsBaseline, suggestion }` or `null`. Inject a `RECOVERY ALERT` block into the briefing prompt; add a matching live-call note in `lib/vapi.ts` so a mid-call "how's my recovery" with a low score triggers the same offer. Degrades to `null` when history is thin — never fabricate.
    - **Honesty guard:** only claim a drop the data supports; never say Whoop measured something intraday it didn't (reuse the V2 honesty wording).
  - **Part B — Correlations over time (the high-value piece).**
    - **Goal:** With ≥~10–14 days of data, surface 1–2 plain-English patterns tied to a concrete calendar action: e.g. *"Your recovery runs ~X% lower the day after evenings with a meeting past 7pm — want me to keep this week's evenings clear after 7?"* or *"You sleep ~N min less when your last event ends after 9pm."*
    - **Impl:** new pure module `lib/whoopCorrelations.ts` — input = Whoop history (recovery/sleep/strain by date) **+ the user's recent calendar history**; output = ranked plain-English insights with a confidence/sample-size gate. Returns `null`/empty below the data threshold (briefing simply omits the section). Surface at most ONE correlation in the briefing when confidence is sufficient; pair it with an offer to act.
    - **⚠️ Key dependency / scoping decision (flag before building):** correlations need **historical calendar context**, but today we only fetch the *current* day's calendar. Two options — Core to pick:
      1. **Pull a 14-day past window from Google** (`timeMin`/`timeMax` in the past) at briefing time and correlate by date — *no new storage, simplest, preferred.*
      2. Log a lightweight daily event-summary snapshot going forward (new table) — more durable but slower to produce signal and needs a Security-coordinated schema add.
      Start with option 1 unless it proves too heavy.
    - **Strictness:** never assert a correlation without enough days; phrase with the implicit window ("over the last two weeks"); never fabricate a number.
  - **Acceptance:** (A) On a red/sharp-drop recovery morning, the briefing proactively offers to lighten the day with a specific block; "yes" → Edge moves it. (B) After ~2 weeks of data, the briefing surfaces one real, data-backed sleep/recovery↔calendar pattern with an offer to act; below the threshold it stays silent (no invented patterns).
  - **Coordination:** `lib/briefing.ts` + new `lib/whoop*` modules are Core-owned. Live-call note touches Shared `lib/vapi.ts` (claim in Status Board). History primitives already exist (Security) — no new Security work unless Core picks option 2 (then coordinate a schema add). Update `specs/whoop-integration.md` (V2.5/V3 sections) + this changelog when shipped.
- [x] **Multi-day all-day events + ability to edit/fix them** — _from a real user call, 2026-06-09._ **✅ Shipped 2026-06-09 (see changelog).**
  - **Symptom:** User asked Edge to "create all-day events from June 25–28." Edge made four separate one-day all-day events instead of one spanning event, then could not fix it when asked.
  - **Root cause:**
    - `createEvent` all-day branch (`app/api/vapi/tool-call/route.ts:279`) hardcodes `end: { date: nextDay(dateOnly) }` → it can only make a *single-day* all-day event. No range param, so the model is forced to loop one-per-day.
    - No tool can re-date an all-day event afterward: `editEvent` only changes description/location; `moveEvent` takes datetimes, not date-only. So "fix it" is structurally impossible.
  - **Fix:**
    1. Add an inclusive `endDate` param to the all-day path; set Google `end.date = nextDay(endDateInclusive)` so one event spans the range (25→28 inclusive ⇒ start `2026-06-25`, end `2026-06-29`).
    2. Make all-day events editable — let `moveEvent`/`editEvent` (or a new path) change an all-day event's start/end *dates*, so "make it just the 26th" / "extend it to the 30th" works.
    3. Update the `createEvent` tool schema + system-prompt guidance in `lib/vapi.ts` so the model passes one spanning all-day event for a date range instead of looping.
  - **Acceptance:** "Create an all-day event from June 25 to 28" → one event spanning 25–28. "Actually just the 26th" → adjusts in place. "Remove it" → gone in one action.
  - **Coordination:** touches `app/api/vapi/tool-call/route.ts` + `lib/vapi.ts` (Shared — constitution §5). Core owns the calendar behavior; ping Security since these are vapi-path files.
- [x] **Research notes should replace, not pile up** — _from a real user call, 2026-06-09 (Hong Kong gyms w/ sauna)._ **✅ Shipped 2026-06-09 (see changelog).**
  - **Symptom:** Re-running research on an event stacks the new findings on top of the old research. Notes should show only the newest / most relevant, not an accumulating pile.
  - **Root cause:** `researchToEvent` (`app/api/vapi/tool-call/route.ts:268`) always appends — `description: e.description ? \`${e.description}\n\n${block}\` : block`. No replace/dedupe of prior research.
  - **Fix:** Wrap each research block in a recognizable delimiter (e.g. a marker header). On every research call, strip any prior research block(s) and write only the fresh findings, while **preserving the user's own (non-research) notes** in the description. Keep the existing "most relevant first, up to 6" prompt.
  - **Acceptance:** Researching the same event twice → description shows only the latest research plus any user-typed notes; no duplicated/stacked piles.
  - **Coordination:** same Shared file as the all-day ticket (`tool-call/route.ts`) — batch them; both touch event description/creation logic.

### Next (decided)
- [x] **Email-reply tracking → proactive surfacing in the briefing** — **✅ SHIPPED 2026-06-10 (by PM session directly to master)**. `lib/replies.ts` (`checkOutreachReplies` + `understandReply`); `lib/briefing.ts` calls it; `draftEmail` registers `threadId` → `watched_threads`; `lib/gmail.ts` `readThread` (Security); `notifications` table + `notificationQueries`. Degrades safely if `gmail.readonly` not yet granted.
- [x] **Notifications v1: in-app notification center** — **✅ SHIPPED 2026-06-10 (by PM session directly to master)**. Bell icon + unread badge + panel in dashboard; `/api/notifications` GET/POST; `notificationQueries` CRUD. Replies trigger notifications at briefing time + on-demand via "↻ Check for replies" button.
- [x] **★ TOP PRIORITY: Email drafting — outreach with calendar availability (draft-only Gmail)** — _PM decision 2026-06-09, user request._ **✅ SHIPPED & working end-to-end 2026-06-09 (after fixing moveEvent trailing-space key + setting the draftEmail tool server URL). Left here for reference; superseded by the reply-tracking ticket above.**
  - **Goal:** After research (e.g. plumbers), Edge drafts a personalized outreach email per contact asking their availability this week and **proposing the user's real open calendar slots**, saved as a **Gmail draft** for the user to review + send. Draft-only — Edge NEVER sends.
  - **Depends on 🔒 Security:** the Gmail OAuth scope + a safe draft-create helper (see `ROADMAP-SECURITY.md` "Gmail access"). Gate on that landing first.
  - **New tool:** `draftEmail` in `tool-call/route.ts` — params: `recipients` (name + email, from research results), `ask` (e.g. "when can you come this week"), `proposeAvailability` (bool), `dateRange` (defaults to this week).
  - **Implementation:** (a) pull availability by reusing `findFreeSlots` → format proposed times in the user's tz; (b) compose a short, polite plain-text email per recipient (Claude) including the ask + proposed slots; (c) create the draft via `gmail.users.drafts.create` (new `lib/gmail.ts` wrapper using the OAuth client Security extends); (d) gracefully skip recipients with no email ("Email: not found") and tell the user which lacked one; (e) `recordUndo` = delete the draft.
  - **Trust:** never call `messages.send`. Confirm back: "Drafted N emails in your Gmail — review and send."
  - **Acceptance:** After researching plumbers, "draft emails asking when they can come this week and suggest my availability" → N Gmail drafts, each with the ask + the user's real open slots; nothing sent.
  - **Coordination:** touches Shared `tool-call/route.ts`; `lib/gmail.ts` is Core-owned but rides on the OAuth scope/token Security manages. Effort ~2–3d after scope lands.
- [x] **"Recent activity" review surface** — _PM decision 2026-06-09._ **✅ Shipped 2026-06-10 (see changelog).**
  - **Why:** The user keeps discovering messy calendar edits mid-call (duplicate all-day events, piled-up research). A dashboard feed of what Edge did — with one-tap undo/correct — turns silent frustration into something visible and fixable.
  - **Scope:** Dashboard view listing recent actions Edge took (newest first): what changed, when, on which event, with an **Undo** affordance per row (reuse the existing `undo_log` inverse ops shipped in `28f364d`).
  - **Dependency (cross-lane):** wants a clean, append-only activity feed as its data source → **Security item #7 (harden audit log: before/after snapshots, append-only table)**. Two-phase: Security #7 builds the backbone, Core builds the view on top. A quick v0 can read the current `undo_log` if we want something shippable before #7 lands.
  - **Acceptance:** From the dashboard the user can see the last N actions Edge took and undo any one of them without a voice call.

- [x] ~~**Travel price lookup (flights + hotels) → trip event**~~ — ❌ **DROPPED 2026-06-09.** Rationale: low-frequency (people book travel a few times/year) and a commoditized space with strong incumbents (Google Flights, Kayak) — hard to beat the user's existing workflow. Refocusing on **research** instead (high-frequency, unique to Edge's research→save→act chain). _PM + user decision._
  - **Goal:** On a call, Edge looks up **real** flight/hotel prices and saves the options to a calendar trip event. Voice flow: "What are flights to Hong Kong on June 25?" → Edge fetches options → reads them back → attaches them to a trip event.
  - **Data source (decided):** a real travel-pricing API, **not** web search — fares must be quotable with confidence. Candidate: **Amadeus Self-Service** (flight offers search + hotel search, free test tier). Wrap in a new `lib/travel.ts`.
  - **New tool:** `researchTravel` in `tool-call/route.ts` — params: `type` (flight|hotel), `origin`, `destination`, `departDate` (YYYY-MM-DD), `returnDate?`, `passengers?`, `nights?`. Format results as clean plain-text (reuse the `researchToEvent` note-cleaning), then patch onto a trip event (create one if none exists) via the same `recordUndo` path.
  - **Trust:** only quote prices the API returned — keep the "NEVER INVENT TRAVEL FACTS" guardrail (now Edge can cite the API). Include currency and a "fetched <date>" stamp since fares change. Follows the research-replace rule (don't pile up stale quotes).
  - **Coordination (Security):** introduces a new external API credential (`AMADEUS_*`) → **Security owns provisioning + securing the secret, env config, and a rate-limit/cost guardrail** (these calls cost money / are rate-limited). Coordinate before merging. Also touches the Shared `tool-call/route.ts`.
  - **Acceptance:** "Find flights to Hong Kong June 25 returning July 2" → Edge returns real fare options sourced from the API, timestamped, saved to a HK trip event. Re-running replaces stale quotes rather than stacking them.
  - **Effort:** ~2–4d.

### Chief of Staff calendar tools (2026-06-10)
- [x] **Admin calendar API — read + create events on Derrick's behalf** ✅ Shipped 2026-06-10 (see changelog). — _Chief of Staff session needs direct Google Calendar access so it can book events without going through Edge or manual entry._
  - **Scope:** Two new admin endpoints, protected by `x-admin-secret` header (same pattern as `app/api/admin/latest-briefing/route.ts`):
    1. `GET /api/admin/calendar/events?email=derrick@deltaedg3.com&days=7` — returns upcoming events for the next N days using the existing `lib/calendar.ts` helpers + stored OAuth token.
    2. `POST /api/admin/calendar/events` — creates a calendar event. Body: `{ email, title, start (ISO), end (ISO), description? }`. Reuse existing `createCalendarEvent` logic from `lib/calendar.ts`.
  - **Auth:** same `checkAdminAuth` pattern as other admin routes — `x-admin-secret` header checked against `ADMIN_SECRET` env var.
  - **No new scopes needed** — calendar read/write is already granted.
  - **Acceptance:** Chief of Staff session can fetch Derrick's upcoming calendar and create events (reminders, focus blocks) directly via these endpoints.
  - **Effort:** ~1–2h. Self-contained, additive, no Shared files touched.

### Dashboard polish (from dogfooding 2026-06-10) — small, quick
- [x] **Re-link flow shouldn't route through onboarding.** **✅ Fixed 2026-06-10 (PM session).** Callback now redirects already-onboarded users to `/dashboard?linked=1` with a "Google account linked ✓" toast; first-time users still continue to onboarding.
- [x] **Profile page: "Your Profile" section is too long.** **✅ Fixed 2026-06-10 (PM session).** Section is now collapsible — collapsed to ~3 lines by default with a "▼ Show more" toggle.
- [x] **"Next call" section: the Undo button is unclear.** **✅ Addressed 2026-06-10.** Sidebar button now shows only when an undoable action exists, labeled "Edge's last calendar change — {what}". Full per-action undo lives in the new Activity tab (⏪).

### UX/UI — Onboarding v2 (2026-06-10, from designer audit · PM sign-off pending)
> Goal: get a new user to their first moment of value in under 90 seconds. Current profile step is the #1 drop-off risk. Batch these together — they ship as one onboarding rewrite.

- [ ] **Flip onboarding step order + defer profile** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** Step 1 sends users out of the app to ChatGPT before they've seen any value. Highest drop-off risk in the entire funnel.
  - **Fix:** New order: **Calendar → Priorities → Call Time → Profile (optional, post-signup)**. Profile step becomes a dashboard prompt ("Help Edg3 know you better") shown after the first briefing, when the user is already bought in. Profile is still supported — just not gating.
  - **Acceptance:** A new user can complete onboarding and reach the dashboard without ever touching the profile step.

- [ ] **Rewrite calendar step value prop** — _UX audit 2026-06-10. ~1h_
  - **Problem:** "Read-only access. EDG3 sees your events to build smarter briefings. Nothing is modified." doesn't motivate action.
  - **Fix:** Replace with: *"Edg3 tells you when your week doesn't match your priorities. That only works if it can see your week."* Also: note is currently inaccurate (calendar access is read-write, not read-only — needed for creating/moving events). Fix copy to reflect reality while staying reassuring.
  - **Acceptance:** Copy is accurate and motivating. No mention of "read-only."

- [ ] **Day 1 preview briefing post-onboarding** — _UX audit 2026-06-10. ~1d_
  - **Problem:** If the user misses or declines the intro call, there's a 12–24hr gap before any value arrives. No designed aha moment.
  - **Fix:** Immediately after onboarding completes, auto-generate and display a briefing preview on the dashboard using the data already collected (priorities + calendar if connected). Label it clearly: *"Here's what Edg3 already knows about your week."* This is the aha moment — it should happen in seconds, not tomorrow morning.
  - **Acceptance:** Every new user sees a personalized preview on first dashboard load, regardless of whether they took the intro call.

- [ ] **International users: phone number fallback message** — _UX audit 2026-06-10. ~1h_
  - **Problem:** Call Time step requires a US/Canada number with no recovery path for international users — dead end with zero explanation.
  - **Fix:** Below the phone input, add: *"Outside the US or Canada? Skip for now — you'll receive web briefings instead, and can add a number later."* Add a skip link that completes setup without a phone number.
  - **Acceptance:** Non-US users can complete onboarding without a phone number and reach the dashboard.

---

### UX/UI — Dashboard v2 (2026-06-10, from designer audit · PM sign-off pending)
> Goal: answer "what matters today?" within 3 seconds of opening the dashboard. Current layout buries today's focus behind tabs and leads with an input box.

- [ ] **Move UpdateBox (chat) below the briefing list** — _UX audit 2026-06-10. ~1h_
  - **Problem:** The "Tell Edge something" chat box is the first element a user sees on every dashboard load. It's a secondary input flow masquerading as the primary one.
  - **Fix:** Move `<UpdateBox />` below the briefing list/Today view. The hero of the dashboard should be today's briefing.
  - **Acceptance:** Dashboard opens on the briefing/Today content; chat box is reachable by scrolling.

- [ ] **Hide notification bell at zero-state** — _UX audit 2026-06-10. ~30min_
  - **Problem:** The bell icon renders for all users at all times, adding chrome for a feature most new users won't trigger in their first 30 days.
  - **Fix:** Render the bell only when `notifUnread > 0` or when the user has at least one watched thread. Zero-state = no bell.
  - **Acceptance:** A brand-new user's dashboard has no notification bell. Bell appears once there's something to notify about.

- [ ] **"Today" consolidated tab as default dashboard view** — _UX audit 2026-06-10. ~1–2d_
  - **Problem:** The briefings tab shows a collapsed history list; tasks and priorities require separate tab clicks. Opening the dashboard doesn't answer "what matters today?"
  - **Fix:** Add a **Today** tab (or rename Briefings → Today) that shows in a single view: (1) latest briefing content expanded by default, (2) today's tasks, (3) current priorities. This becomes the landing tab. Briefing history moves to a "Past briefings" collapsible section below.
  - **Acceptance:** A user opening the dashboard at 9am sees their briefing, today's tasks, and priorities without clicking any tabs.

- [ ] **Collapse to 3 tabs: Today / Memory / Settings** — _UX audit 2026-06-10. ~1d_
  - **Problem:** Five tabs (Briefings / Tasks / Priorities / Memory / Profile) cause decision fatigue and split content that belongs together.
  - **Fix:** Merge into three tabs: **Today** (briefing + tasks + priorities), **Memory** (unchanged), **Settings** (profile summary + call settings + calendar connect — currently split across Profile tab and sidebar). Remove the standalone Priorities and Tasks tabs.
  - **Note:** Coordinate with the Today tab ticket above — ship together.
  - **Acceptance:** Dashboard has exactly 3 tabs. All existing functionality is reachable within them.

---

### UX/UI — 30-Day Retention (2026-06-10, from designer audit · PM sign-off pending)
> These address the habit-formation gap: nothing currently pulls a user back after missed calls or a streak break.

- [ ] **Priority drift prompt at 7 days** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** No mechanism prompts users to keep priorities current. Stale priorities = stale briefings = lower perceived value.
  - **Fix:** If `priorities.updated_at` is older than 7 days, show a dashboard banner: *"Are these still your top priorities this week? [Update] [Yes, keep them]"*. Tapping "Yes, keep them" updates the timestamp; tapping Update opens the priorities editor inline.
  - **Acceptance:** Users who haven't updated priorities in 7+ days see the prompt on dashboard load. Users who dismiss it don't see it again for another 7 days.

- [ ] **Streak/consistency indicator in sidebar** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** No visual feedback for consistent engagement. Users don't feel the cost of breaking a streak, so there's no loss-aversion hook.
  - **Fix:** Add a simple call-streak counter below the "Next call" card in the sidebar: *"🔥 7-day streak"* (increments on completed briefing calls, resets on a missed day). No gamification overload — one number, one label.
  - **Acceptance:** Sidebar shows current streak. Streak increments after a completed call. Resets to 0 after a missed day.

- [ ] **Weekly summary email/digest** — _UX audit 2026-06-10. ~1d (needs email infra confirmation)_
  - **Problem:** If a user misses several calls in a row, nothing brings them back. The product goes silent.
  - **Fix:** A short weekly email (Sunday evening or Monday morning): what Edg3 observed this week, whether the user's calendar matched their priorities, any open threads or unresolved tasks. Plain text, personal tone. Opt-out in one click.
  - **Dependency:** Needs an email sender (Resend / SendGrid / similar). Confirm with PM before building — if no sender is configured, this stays in Later.
  - **Acceptance:** Users receive a weekly digest. Unsubscribe works in one click. Digest is generated from existing briefing + priority data with no new data collection.

---

### Later / candidates (not yet committed)
- [ ] **🤝 Chief-of-Staff ↔ Edg3 bridge (founder tooling / intensive dogfooding)** — _user idea 2026-06-10. Build RIGHT AFTER the core loop is verified (the end-to-end test)._ Expose Edg3's capabilities (start with `draft_email` w/ availability, then `find_free_time` / `read_calendar` / `research`) to the **Chief of Staff agent** so it can *act through* Edg3 to help Derrick day-to-day. **Form:** a small **MCP server** (preferred) or CLI the CoS calls. **Value:** (a) makes Derrick effective now; (b) the CoS using Edg3 daily is the best bug-finder we have → de-risks launch. **Tradeoff:** internal tooling, not the product (scope vs the Sept freeze) — justified by the dogfooding payoff. **⚠️ Auth (🔒 Security):** needs a token that acts as the user against Edg3's API (account-level access) — coordinate with Security; for a single-user pre-launch tool a static `AGENT_TOKEN`-gated endpoint acting as user 1 is acceptable but must be deliberate. **Sequencing:** gated on (1) the core verified working, (2) Security building the token endpoint. Start with ONE capability (email drafting), prove the loop, expand.
- [ ] **🔮 V2 / POST-LAUNCH — Google Drive / Sheets awareness** (PM-deferred 2026-06-10, user idea). Edge pulls the doc/spreadsheet tied to a calendar event (e.g. the weekly P&L sheet for the "P&L review" block) and works it into the briefing. **Deferred because:** it's another *restricted* Google scope (compounds the verification we haven't started), it's new scope against the September freeze, and summarizing financial spreadsheets accurately is high-trust/high-risk. Lighter near-term paths if ever needed: (a) surface the doc *link* in the briefing (no new scope); (b) `drive.file` + file-picker so the user designates only specific docs (non-restricted scope).
- [ ] Onboarding: smoother first-run (connect calendar → first briefing) flow.
- [ ] Briefing: richer briefing content / personalization controls.
- [ ] Calendar: better event review & edit UX from the dashboard.

### Later
- [ ] _…_

---

## Guardrails for this lane
- Stay in the Core-owned files (constitution §3). For `lib/db.ts` schema changes,
  follow the Shared-file protocol (§5).
- New writes that create calendar events must be **idempotency-aware** — coordinate
  with the Security lane so features don't reintroduce duplicate-on-retry bugs.
- Don't weaken any destructive-action confirmation or undo behavior the Security
  lane has shipped.

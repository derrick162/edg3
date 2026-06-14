# EDG3 — Coordination Constitution (read me first)

> **This file is the shared constitution for every EDG3 session.** It is
> auto-loaded into every session via `CLAUDE.md`. It does **not** hold the task
> backlog — it defines *how the parallel lanes work together without colliding*.
> The product manager routes feedback into the right lane; engineers build only
> in their lane. The work lives in two lane roadmaps:
>
> - 🛠️ **[`ROADMAP-CORE.md`](ROADMAP-CORE.md)** — the Core (features/product) lane.
> - 🔒 **[`ROADMAP-SECURITY.md`](ROADMAP-SECURITY.md)** — the Security & Reliability lane.
> - 🎨 **[`ROADMAP-DESIGN.md`](ROADMAP-DESIGN.md)** — the UX/UI Design lane. See also `DESIGN.md` (asset pack).
>
> Read this constitution, then read **only your own lane's roadmap**. Do not plan
> from memory or from `docs/EDG3-Roadmap.xlsx` — **that spreadsheet is deprecated.**

We optimize for **speed through isolation**: each lane runs flat-out in its own
worktree and branch, and integrates to `master` in small, frequent merges.

---

## 0. Roles
- **Product Manager (you + the Chief-of-Staff session)** — takes product feedback
  from the user, decides which engineer/lane owns it, writes it into that lane's
  roadmap, and keeps the lanes from colliding. Does not write feature code.
- **Core Engineer** — builds user-facing product (see `ROADMAP-CORE.md`).
- **Security & Reliability Engineer** — builds trust/secrets/infra (see `ROADMAP-SECURITY.md`).
- **UX/UI Designer** — owns the design system + the visual/UX of the app (see `ROADMAP-DESIGN.md` + `DESIGN.md`). Works the presentation layer; coordinates with Core on shared page files.

## 1. Who am I? (pick your lane)
| If your session is… | Lane | Roadmap | Branch | Worktree folder |
|---|---|---|---|---|
| **Edg3 Engineer (Core)** | 🛠️ Core | `ROADMAP-CORE.md` | `core` | `C:\Users\Derrick\edg3-core` |
| **Edg3 Engineer (Security & Reliability)** | 🔒 Security | `ROADMAP-SECURITY.md` | `security` | `C:\Users\Derrick\edg3-security` |
| **Edg3 UX/UI Designer** | 🎨 Design | `ROADMAP-DESIGN.md` | `design` | `C:\Users\Derrick\edg3-design` |
| **Product Manager / coordinator** | — | this file | `master` | `C:\Users\Derrick\edg3` |

If you don't know which you are, **stop and ask the user** before editing anything.

---

## 2. Isolation — git worktrees (the #1 rule)
**Never run two lanes in the same working directory.** Each lane gets its own
worktree (separate folder, separate branch, one underlying repo). One-time setup,
run from `C:\Users\Derrick\edg3`:

```powershell
git worktree add ../edg3-core     -b core
git worktree add ../edg3-security -b security
git worktree add ../edg3-design   -b design
```

Then point each desktop-app session at its own folder. After that, a lane only
ever edits files inside **its own** worktree folder.

## 3. Ownership map (who owns which files)
Stay in your lane's files — this is what makes parallel work conflict-free.

**🛠️ Core owns** — the product / feature surface:
- `lib/calendar.ts`, `lib/briefing.ts`, `lib/eventMatch.ts`, `lib/time.ts`
- `lib/outreach.ts` — email **composition** (body, availability formatting, recipient filtering); calls Security's `lib/gmail.ts` to actually create the draft.
- `app/dashboard/**`, `app/onboarding/**`
- `app/api/briefing/**`, `app/api/calendar/**`, `app/api/memory/**`, `app/api/profile/**`, `app/api/tasks/**`, `app/api/onboarding/**`, `app/api/undo/**` (the *user-facing* side)
- New UI, new product flows

**🔒 Security & Reliability owns** — the trust / secrets / infra surface:
- `lib/auth.ts`, `lib/crypto.ts`, `lib/vapi.ts`, `lib/scheduler.ts`, `lib/undo.ts` (the *recording* side)
- `lib/gmail.ts` + `lib/google-auth.ts` — Gmail **access primitive** (guarded `createDraft`, scope authority, rate limit, audit). Core composes; Security executes the send/draft. _(Resolves the 2026-06-09 dual-`gmail.ts` collision.)_
- `app/api/auth/**`, `app/api/admin/**`, `app/api/vapi/**`
- `app/login/**`, `app/admin-login/**`, `app/signup/**`
- Cross-cutting: rate limiting, encryption-at-rest, audit logging, idempotency, backups/durability

**🎨 Design owns** — the design system + presentation:
- `app/globals.css` — design tokens, component classes (`glass-card`, `btn-*`, `input`, `badge`, `orb`, etc.). The single source of visual truth; consolidate inline styles into here.
- Visual/UX direction, layout, copy polish, and design specs across all pages.
- `DESIGN.md` (the asset pack).

**⚠️ Shared — coordinate before touching** (see §5):
- `lib/db.ts` (schema — both lanes add tables/columns)
- `app/api/vapi/tool-call/route.ts` and `lib/vapi.ts` — **Core owns the calendar tool *behavior*** (the `createEvent`/`moveEvent`/etc. handlers + the tool/system-prompt guidance); **Security owns the *auth/secret + webhook integrity*** of these same files.
- **Page UI files** (`app/dashboard/**`, `app/onboarding/**`, `app/login/**`, `app/signup/**`, `app/page.tsx`, etc.) — **Core owns behavior/data/logic; Design owns visual/layout/copy.** Claim in the Status Board before editing, prefer small diffs, merge frequently. (Tie-break: Core wins on logic, Design wins on look.)
- `CLAUDE.md`, `AGENTS.md`, this `ROADMAP.md`, the lane roadmaps' structure
- Anything not clearly in one lane above

## 4. Integration — small, frequent, direct merges
1. Commit **small** and often on your own branch.
2. Before merging up, sync down (`git merge master` into your branch) so conflicts surface while they're tiny.
3. Merge your branch to `master` **as soon as a unit of work is green** — don't batch a day's work into one giant merge. Small batches = trivial conflicts.
4. `master` is the source of truth. If your branch and `master` disagree, `master` wins; rebase/merge on it.
5. Update **your lane roadmap's changelog** in the same commit that ships the work.

## 5. Shared-file protocol
For anything in the ⚠️ Shared list:
1. **Claim it** in the Status Board (§6) before editing.
2. Prefer **additive** changes (new column, new function) over rewrites.
3. Merge to `master` **immediately** after, then have the PM tell the other lane to sync down.
4. Tie-breaks: Security wins on security-sensitive files; Core wins on feature files; the PM breaks any remaining tie.

## 6. Status Board (live — keep it current)
Each lane edits **only its own row** when it starts/stops a unit of work, so the
other lane and the PM can see live ownership claims.

| Lane | Branch | Now working on | Touching files | Updated |
|---|---|---|---|---|
| 🛠️ Core | `core` | _(idle — ✅ **Whoop V1 + V2** (energy-matched time-blocking, `buildEnergyMatchingBlock` + ENERGY PROFILE) + **prompt-consolidation/trim pass** + privacy Whoop section. Awaiting PM.)_ | — | 2026-06-13 |
| 🔒 Security | `security` | _(idle — ✅ **Whoop history fetch SHIPPED** (`getRecoveryHistory`, `getSleepHistory`, `getStrainHistory`; 391/391 green) + restore drill + health check + Whoop OAuth. Awaiting PM.)_ | `lib/whoop.ts` | 2026-06-13 |
| 🔧 PM | `master` | _(✅ fixed dashboard UTF-8 corruption from a Design commit that broke Turbopack/Railway deploys; created + wired the 3 Vapi tools; whoop callback now surfaces the real OAuth error.)_ | — | 2026-06-13 |
| 🎨 Design | `design` | _(idle — ✅ RecoveryCard component + sparkline + DESIGN.md §7 spec shipped. Awaiting PM for next tasks.)_ | — | 2026-06-13 |

> **★ Email feature go-live checklist (code done — these remain):**
> 1. Set `DATA_ENCRYPTION_KEY` on Railway (activates at-rest encryption; no-op until set).
> 2. Deploy master to production.
> 3. Create the `draftEmail` tool in the Vapi dashboard (params below) + add its tool ID in `lib/vapi.ts:188`.
> 4. User re-consents Google (reconnect account → grants Gmail).
> 5. `draftEmail` Vapi params: `recipients` (array of {name, email}), `ask` (string), `proposeAvailability` (boolean), `startDate` (string/date), `endDate` (string/date), `subject` (string, optional).

---

## Changelog
- **2026-06-13** — **RecoveryCard component (Design).** `components/ui/RecoveryCard.tsx` — self-contained presentational card: color-coded 36px score, tier label + energy dot, sleep/strain stat row, inline SVG sparkline with area fill + end-cap dot (falls back to placeholder before history loads). Exports `RecoveryCard`, `RecoveryCardProps`, `RecoveryTier`, `RecoveryHistoryPoint`. Added sparkline tokens to `app/globals.css`. Spec in `DESIGN.md §7`. Core: import from `@/components/ui`, derive tier with `s >= 67 ? 'high' : s >= 34 ? 'medium' : 'low'`.
- **2026-06-13** — **Whoop V2 — energy-matched time-blocking (Core).** (`40155fd`)
  - `buildEnergyMatchingBlock(preferences, recovery)` pure function in `lib/briefing.ts`.
    Scans preference-category facts for energy-profile keywords (peak, trough, deep work,
    admin, afternoon dip, flow state, focus block, etc.). Returns null when no energy
    profile is stored — degrade silently, briefing never blocked.
  - Combines user's stated energy preferences with today's Whoop recovery as the daily
    modulator (green ≥67% → full capacity; yellow 34–66% → proceed; red ≤33% → protect
    peak, lean toward admin). Includes honesty guard: never claims Whoop measured intraday.
  - Briefing injection: ENERGY PROFILE block injected after whoopContextBlock when facts
    exist. Section 5 (CALENDAR BLOCKS) updated to match deep/creative work to stated peak
    window and batch low-energy tasks to stated trough. Scale to today's recovery tier.
    Example: "Recovery's high and it's your nine to eleven peak — want me to block
    vibe-coding there? I'll push email to your two PM dip."
  - Soft invite: if Whoop connected but no energy profile yet, adds one line at the end
    of the closing section inviting the user to share their peak/trough hours.
  - Live-call support: ENERGY MATCHING note added to CALENDAR TOOLS in `lib/vapi.ts` —
    when recommending or creating blocks mid-call, match to energy profile + recovery.
  - 8 new tests. 371/371 green, tsc clean, next build clean.
  - **How it activates:** user tells Edge their energy profile mid-call ("my peak is nine
    to eleven, vibe-coding is high-energy, email is admin") → `rememberPreference()` stores
    as preference facts → next morning's briefing automatically does energy-matched blocking.
- **2026-06-13** — **Prompt consolidation + privacy Whoop section (Core).** (`bc843f6`)
  - `lib/vapi.ts` trimmed ~30% with no behaviour dropped. Anchor: GROUNDED & DECISIVE (only
    state what the data gives you, only ask what you don't know, act, refine, never fabricate).
  - PREFERENCES: ~90→55 words. BE DECISIVE: absorbed ANTI-LOOP (~160→75 combined).
  - HONEST FAILURE: ~100→50 words. researchToEvent guidance: ~180→90 words (rules intact).
  - NEVER INVENT FACTS + GROUNDED OBSERVATIONS + NO INVENTED NUMBERS → single GROUNDED &
    DECISIVE anchor block. 363/363 green, tsc clean, next build clean.
  - `app/privacy/page.tsx`: added "Whoop Health Data" section (recovery/sleep/strain,
    read-only, encrypted at rest, disconnect any time). Required before Whoop rolls to users.
- **2026-06-13** — **Whoop V1 — recovery-aware briefings + Connect UI (Core).** (`7412561`)
  - Consumes Security's `lib/whoop.ts` (`getLatestRecovery`/`getLastSleep`/`getRecentStrain`).
  - `buildWhoopSection()` pure helper in `lib/briefing.ts`: formats recovery/sleep/strain into
    a compact line ("RECOVERY: 34% · SLEEP: 5h12m · STRAIN: 14.2"); returns null when all
    inputs null — health section omitted silently. 7 new tests.
  - Whoop fetches run in parallel with the calendar fetch (`.catch(() => null)` guards) so
    ANY failure degrades silently — briefing never blocked.
  - HEALTH DATA block + recovery-tier pacing guidance injected into the briefing prompt when
    connected (green ≥67% → push hard; yellow 34–66% → normal; red ≤33% → keep lighter,
    defer deep work). Model weaves one pacing note into section 1 + factors recovery into
    section 3 priority/defer call.
  - Dashboard: `whoopConnected` state, `/api/whoop/status` polled on load, `connectWhoop()`/
    `disconnectWhoop()` handlers, "⚡ Connect Whoop" / connected + Disconnect UI mirroring
    the Google calendar controls.
  - 363/363 green, tsc clean, next build clean.
  - ⚠️ **External step (user):** Create Whoop developer app at developer.whoop.com →
    set `WHOOP_CLIENT_ID` + `WHOOP_CLIENT_SECRET` on Railway, redirect URI =
    `https://<app>/api/whoop/callback`. Then connect from the dashboard sidebar.
- **2026-06-13** — **Research quality guidance (Core).** (`7e59ee2`)
  - **ROOT CAUSE FIX for wrong-side results (SpotHero on "rent OUT parking spot").** Edge
    grabbed a plausible brand without registering the user's actual role (supplier vs consumer).
  - RESEARCH QUALITY block added to `researchToEvent` in `lib/vapi.ts`:
    1. Nail exact role/direction first: "rent OUT"/"list"/"host" = supplier → listing platforms;
       "find"/"book" = consumer. Build the query around the user's actual goal.
    2. Apply known context (location, preferences, facts) before the first search.
    3. Relevance-check results before saving: verify each result fits the intent; drop
       mismatches; refine and re-search if off. Never save results that contradict the user's goal.
  - Folds into the existing "grounded + capable" cluster. Prompt-only; 335/335 green.
- **2026-06-13** — **moveEvent organizer check (Core).** (`704f4d0`)
  - **ROOT CAUSE FIX for "couldn't move it" on other people's meetings.** `moveEvent`
    checked the CALENDAR's accessRole but not the EVENT's organizer — Google 403s
    time changes from non-organizers.
  - `canUserReschedule(event)` added to `lib/calendarWritable.ts`: returns `true` if
    `organizer.self === true` OR `guestsCanModify === true`; benefit-of-the-doubt `true`
    when organizer field is absent. 7 new tests.
  - Pre-patch check inserted after the calendar-level `isWritable` check: if user
    isn't the organizer, returns honest message naming them
    ("'Faiza CIBC meeting' was set up by Faiza — Google only lets the organizer
    reschedule it…") + offer to draft a reschedule request via draftEmail.
  - Generic patch-failure fallback improved: now explains organizer/restricted-calendar
    possibility and offers the draft path.
  - `draftEmail` prompt note added: when moveEvent bounces on organizer, call draftEmail
    with `recipients:[{name, email}]` from the organizer info in the failure message.
  - 335/335 green, tsc clean, next build clean.
- **2026-06-11** — **cleanupEvents batch delete + resolveEventExact + Edg3 self-name (Core).** (`b66b20f`)
  - **ROOT CAUSE FIX for consolidation failures.** Two compounding causes found from live call:
    (1) 3 originals with different titles required 3 separate `deleteEvent`+confirm-token handshakes
    — one "yes" can't fulfill all three. (2) Fuzzy-title collision: newly-created "Tax and expenses"
    matched query "tax", causing disambiguation bail instead of clean delete.
  - **`resolveEventExact`** (`lib/eventMatch.ts`): resolves by EXACT startDateTime (60s tolerance),
    not fuzzy title. When `startDateTime` is provided, applies tolerance even for a single candidate
    — the merged event at a different time is never returned. Falls back to title-only for single
    unambiguous matches when no startDateTime given; `startDate` for all-day events.
  - **`cleanupEvents` tool** (`app/api/vapi/tool-call/route.ts`): takes a list of
    `{title, startDateTime?, startDate?, targetEndDate?}` specs; resolves each by exact datetime;
    read-only check; SINGLE confirm-token gate for the whole batch; batch delete loop; undo per
    deleted event.
  - **Consolidation playbook updated** (`lib/vapi.ts`): step 1 now requires noting exact
    startDateTimes before creating the merged event; step 3 calls `cleanupEvents` with those
    exact times so the merged event is never confused with originals.
  - **Self-name fixed**: "You are Edg3 (pronounced 'Edge')" for brand consistency.
  - 8 new `resolveEventExact` tests. 317/317 green, tsc clean, next build clean.
  - ⚠️ **External step**: create `cleanupEvents` tool in Vapi dashboard.
    Params: `events` (array of `{title, startDateTime?, startDate?, targetEndDate?}`),
    `confirmToken` (string, optional). Paste UUID into `lib/vapi.ts` toolIds comment and uncomment.
- **2026-06-13** — **Whoop OAuth integration (Security).** Foundation layer for Whoop health
  data in briefings. New `whoop_tokens` table (encrypted at rest — health PII); `whoopQueries`
  in `lib/db.ts`. `lib/whoop.ts`: OAuth flow (`getAuthUrl`, `exchangeCode`), auto-refresh,
  cached fetch primitive (`getLatestRecovery` / `getLastSleep` / `getRecentStrain`). Four new
  routes: `/api/whoop/connect`, `/api/whoop/callback`, `/api/whoop/disconnect`,
  `/api/whoop/status`. Degrades to null when env vars unset. 21 new tests. 311/311 green.
  **Remaining:** PM sets `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET` on Railway. Core integrates
  `lib/whoop.ts` into `lib/briefing.ts` + adds "Connect Whoop" UI to dashboard.
- **2026-06-11** — **Issues A+B+C — all-day ambiguity + location + endDate guidance (Core).** (`7424c53`)
  - **ISSUE A [BUG] All-day event deletion/move ambiguity**: `deleteEvent` and `moveEvent` now
    accept an optional `targetEndDate` param that pre-filters same-title all-day events to the
    one whose last inclusive day matches before disambiguation. `describeOptions` now shows
    `"Conrad Las Vegas" (all-day Jun 25–Jun 28)` instead of `at all day` so the model can
    identify which span to target. Ambiguous all-day responses direct the model to re-call with
    `targetEndDate` rather than `currentTime` (which is meaningless for all-day events). New
    `prevDay` helper in `lib/time.ts` (companion to `nextDay`; converts Google's exclusive
    `end.date` to last inclusive day). 6 new tests (3 for `prevDay`, 3 for all-day `selectEvent`
    ambiguity branch). ⚠️ **External step**: add `targetEndDate` (string, optional) to the
    `deleteEvent` and `moveEvent` Vapi dashboard tools.
  - **ISSUE B [prompt] Multi-day all-day endDate guidance**: ALL-DAY & MULTI-DAY system-prompt
    guidance now includes an explicit worked example ("Conrad Las Vegas June 25–28" →
    allDay:true, startDateTime:2026-06-25, endDate:2026-06-28) and explicitly forbids omitting
    endDate for multi-day events. DISAMBIGUATION updated to describe the `targetEndDate` path
    for all-day events vs `currentTime` for timed events.
  - **ISSUE C [param+prompt] Location param for createEvent**: `createEvent` now accepts
    optional `location` (string) and writes it to the Google Calendar event. System prompt adds
    LOCATION guidance: set real street address for hotels/venues (e.g. "3000 S Las Vegas Blvd,
    Las Vegas, NV 89109" for Conrad Las Vegas); omit rather than guess. HONEST FAILURE
    reinforced: never claim a field was set unless the tool confirmed it. ⚠️ **External step**:
    add `location` (string, optional) to the `createEvent` Vapi dashboard tool.
  288/288 tests, tsc clean.
- **2026-06-11** — **T4 + T5 + firstName bug (Core).** (`f668d69`, `f138fb1`)
  - **T4 [feature] View-transcript link in Call Summary**: New owner-only
    `GET /api/briefing/[id]` returns the decrypted transcript (enforced via
    `AND user_id = ?`; 404 for any other user). Calendar Call Summary appended
    with `▶ Full transcript: <APP_URL>/dashboard?briefing=<id>`. Dashboard
    handles `?briefing=<id>` deep-link: auto-expands the matching briefing and
    switches to the Briefings tab on load.
  - **T5 [config] Graceful hold instead of silent hangup**: `messagePlan` added
    to both inline-assistant and assistantOverrides with 3 idle messages at 10s
    intervals ("Still here — take your time." / "No rush…" / check-in).
    `silenceTimeoutSeconds` extended 30 → 40. Applied to both briefing and
    open-call modes. ⚠️ Needs live-call validation (idle behaviour can't be
    unit-tested; Vapi field names confirmed against docs but verify on first call).
  - **BUG firstName**: `initiateCall` now derives `firstName` from `userName` and
    uses it in all addressing spots. Edge says "Derrick" not "Derrick Fung".
  282/282 tests, tsc clean.
- **2026-06-11** — **Dogfooding fixes — 3 tickets (Core).** (`d08e7f5`)
  - **T1 [HIGH BUG] Read-only-calendar mutations**: delete/move/edit/research/color
    now check calMeta.accessRole before calling the Google API. Events on
    subscribed/shared read-only calendars return an honest "you can only view that
    calendar — edit it there directly" instead of the misleading "reconnect" 403
    message. calMetaCache replaces calIdsCache (stores id+accessRole+summary).
    `isWritable()` extracted to `lib/calendarWritable.ts` (tested). Added
    console.error with calId+accessRole on deleteEvent/moveEvent failures for
    prod diagnosis. ⚠️ If logs show 403s on WRITABLE calendars, escalate to
    Security (potential scope regression).
  - **T2 [prompt] Briefing opener skips routine events**: GREETING instruction
    now explicitly excludes breakfast/lunch/dinner/gym/meal-prep/daily-habit blocks.
    Opener must land on a meaningful, time-sensitive event; falls back to the top
    priority if nothing qualifies.
  - **T3 [prompt+param] Consolidation description**: `createEvent` handler accepts
    optional `description` param (passed to Google Calendar). System prompt
    CONSOLIDATE guidance: when merging events, pass a description recording what
    was combined. ⚠️ External step: add `description` (string, optional) to the
    createEvent Vapi dashboard tool so the model can pass it.
  282/282 tests, tsc clean.
- **2026-06-11** — **Tasks Open/Completed/All filter + UpdateBox removal (Core).**
  Tasks tab: segmented Open | Completed | All filter (default Open). Open = today/tomorrow
  incomplete + carried-over; "Complete all" and progress badge scoped to Open. Completed =
  last 30 days sorted by `completed_at DESC`. All = full 30-day set. /api/tasks widened 7→30d.
  Removed "Chat with Edge" async note box (CEO decision, pre-launch scope reduction — fully
  reversible from git). UpdateBox component + submitUpdate handler removed from dashboard;
  `app/api/memory/update/route.ts` deleted; `lib/vapi.ts` voice prompt updated so Edge no
  longer references the removed box (says "I'll pick it up on tomorrow's briefing" instead).
  tsc clean. 276/276 green. (`1893a72`)
- **2026-06-11** — **Activity tab migration — audit_log + rich labels + expandable rows (Core).**
  New `lib/activityLabels.ts` (pure, 0 imports): `buildLabel` derives rich one-line labels per
  action type ("Created 'Las Vegas' · all-day Jun 12–15", "Moved 'X' · Jun 8 → Jun 9 at 2 PM",
  etc.); `buildDetail` builds expandable section/diff objects from args+snapshots (research text
  from `snapshot_after.description`, before→after field diffs for edits, full context for all
  others); `buildActivityItems` assembles items from raw audit+undo rows — filters read-only
  actions, time-matches undo rows within ±2 s for per-row undo buttons, respects limit.
  New `GET /api/activity` (user-scoped, no schema changes — time-based undo join in app layer).
  `ActivityTab` refactored: expandable rows with inline detail panel + ▼/▲ chevron; undo button
  uses `e.stopPropagation()` so clicking it does not trigger expand. 31 new tests. 276/276 green.
  (`ba68b64`)
- **2026-06-10** — **Memory UX + fetch reliability (Core).** Call notes list in Memory tab
  now paginates at 20 items/page (Prev/Next + "Page X of Y"; page resets on tab switch or
  data reload). Structured fact categories with >15 items show a "Show all (N)" / "Show less"
  expander. Separately: applied retry-on-transient (3x backoff) to `/api/onboarding/priorities`,
  `/api/memory`, and `/api/tasks` fetches in `loadData` — same class of silent-blank-on-cold-start
  bug as the briefing history fix (9ce624c). tsc clean. 245/245 green. (`14fb440`)
- **2026-06-10** — **Compounding Memory Part C — Visible memory tab (Core).** Memory tab renamed
  "What Edge knows". API route now returns `facts` alongside raw memories. Dashboard renders
  structured facts first, grouped by category (Goals / Projects / People / Preferences / Facts),
  with the entity bolded and a "learned MMM d" provenance stamp per fact. Raw call notes remain
  below under "Call notes". Empty state unchanged. tsc clean. 245/245 green. (`ee2e309`)
  Parts A+B shipped earlier this session (see below).
- **2026-06-10** — **Core-loop features #5–#6 (Core).** #5: call streak — new `lib/streak.ts`
  (pure, client-safe) computes consecutive days with a completed briefing. Dashboard sidebar
  shows 🔥 N-day streak under the Next-call card (≥ 2 days); briefing section 1 weaves in
  one warm acknowledgment ("five mornings straight — momentum"). History API bumped to 30
  for accuracy. 8 new tests. #6: priority-drift refresh — priorities GET now returns
  `getMostRecent` (any week) so the dashboard always shows the latest priorities + `week_of`
  for staleness. New `POST /api/priorities/keep` refreshes `week_of` to the current week
  without text changes. Dashboard sidebar: compact "Still your top priorities?" banner when
  stale (>7 days), [Update] → priorities tab, [Keep] → keep endpoint. Briefing appends one
  gentle nudge at the end of the closing question when stale. 231/231 green.
- **2026-06-10** — **Core-loop features #2–#4 (Core).** #2: briefing section 3 now names a
  specific free slot when offering to block time for an under-served priority ("Want me to
  block Tuesday at two PM for fundraising?"); `lib/vapi.ts` gets a PRIORITY BLOCKING
  instruction so Edge calls `createEvent` immediately when the user says yes — no re-asking.
  #3: new `detectHygieneFlags()` in `lib/alignment.ts` (pure local, no LLM call) — detects
  two patterns: a day with 3+ back-to-back meetings (< 15 min gap), or 3+ busy days with no
  90-min focus block. Result injected into briefing as `CALENDAR HYGIENE FLAG`; section 4
  surfaces it as one punchy item with an offer to fix. 8 new tests; degrades safely to null.
  #4: briefing now opens ACTION ITEMS with one accountability line ("Yesterday you committed
  to X — did that happen?") when `source='edg3'` incomplete tasks from yesterday exist.
  No new DB table — reuses the existing `tasks` table + `extractTasksFromTranscript` pipeline.
  223/223 green.
- **2026-06-10** — **Priority↔calendar alignment (Core).** The briefing's "ALIGNMENT CHECK"
  section was a vague LLM aside; now it's data-backed. New `lib/alignment.ts`: one Haiku call
  classifies the week's events against stated priorities, sums hours per priority, and surfaces
  the biggest unaligned time-sinks. Result injected into the briefing prompt as structured facts
  ("P1 'fundraising' = 0.0h (⚠ none scheduled); unaligned = 6.0h — biggest: 'Team sync' 2.0h").
  The model's section 3 instruction updated to use these facts for a single concrete, empathetic
  observation + one blocking action item. Degrades to null on any failure; briefing falls back
  to the one-line behavior when alignment is unavailable. 8 new tests. 215/215 green.
- **2026-06-10** — **`checkReplies` voice tool (Core).** Derrick could ask "did anyone reply?"
  mid-call but Edge had no tool for it — reply tracking only ran at briefing time. New handler in
  `tool-call/route.ts` calls `checkOutreachReplies(userId)` live and returns a spoken-friendly
  string (up to 3 replies summarized). Crucially distinguishes missing Gmail read scope from "no
  replies" — if scope not granted, tells the user to reconnect in the dashboard instead of silently
  reporting empty. `formatRepliesForVoice` extracted to `lib/replies.ts` so it's unit-testable.
  System prompt updated so Edge knows when to call the tool. 6 new tests. 207/207 green.
  ⚠️ **External step:** user must create a `checkReplies` tool in the Vapi dashboard (no required
  params), then paste the UUID into `lib/vapi.ts` toolIds (placeholder comment is there) and deploy.
- **2026-06-10** — **Two live-dogfooding trust fixes (Core).** Ticket 1: brief's "Edge's actions"
  block now shows plain-English labels ("Added 'X' to your calendar") instead of raw
  `readCalendar · Found 10 event(s)` lines. Read-only/internal calls filtered out; only ok=true
  mutations shown. Helper centralized in `lib/actionSummary.ts` (client-safe) — used by both
  the dashboard and `saveCallSummaryToCalendar` in the webhook route so both surfaces agree.
  Ticket 2: outreach email name correction — `correctRecipientNames()` in `lib/outreach.ts`
  now cross-checks the event title's capitalized tokens against STT-transcribed names and prefers
  the user-typed spelling (e.g. "Email Derrick" + notes "Derek" → drafts greet "Derrick"). Also
  handles the case where the recipient is the user themselves (profile name used). Reduces, does
  not eliminate, STT name errors. 18 new tests. 190/190 green.
- **2026-06-10** — **Added a third lane: 🎨 Design** (UX/UI). New worktree `edg3-design`
  / branch `design` / `ROADMAP-DESIGN.md` + asset pack `DESIGN.md`. Ownership: Design owns
  `app/globals.css` (the design system); page UI files are **Shared** (Core owns behavior,
  Design owns look — coordinate via Status Board). PM/CTO clarified as the product+technical
  lead; a separate Chief of Staff agent owns founder focus. Shared filter = trusted/usable
  launch by early September.
- **2026-06-09** — **INCIDENT — all calls failing** with `anthropic-400-bad-request-
  validation-failed`. **TRUE root cause (found by replaying all 15 tools against the
  Anthropic API with the user's key):** the `moveEvent` Vapi tool had a parameter
  named `"newStartDate "` **with a trailing space** (added via the Vapi editor with
  the all-day fields) — Anthropic requires property keys to match `^[a-zA-Z0-9_.-]{1,64}$`,
  so it rejected EVERY call (all tools sent each turn). Fixed by renaming the key via
  the Vapi API (no redeploy). The trailing space had ALSO silently broken the all-day
  *re-date* feature (handler reads `newStartDate`, model was passing `"newStartDate "`).
  `draftEmail` was a **red herring** — it validated fine on its own; re-enabled after
  verifying all 15 tools pass Anthropic (HTTP 200). Earlier note about `default:""`
  was a real-but-minor cleanup, not the cause. **Hardening (Core):** sanitize Vapi
  tool schemas — trim whitespace in property keys + strip empty defaults — before use.
- **2026-06-09** — **Email feature DEPLOYED.** Pushed master to production (Railway)
  and wired the `draftEmail` Vapi tool ID (`e62078db…`) into `lib/vapi.ts`. Also
  set `DATA_ENCRYPTION_KEY` on Railway (encryption now active). **Remaining for the
  user:** reconnect Google (grant Gmail) + test on a call.
  ⚠️ **NEW Core ticket — privacy policy is inaccurate & blocks Gmail verification:**
  `app/privacy/page.tsx:45` claims calendar access is "read-only" and Edge "never
  modifies/deletes" events — but the app has `calendar.events` write scope and
  creates/moves/deletes events. It also says nothing about **Gmail**. Must be
  corrected to reflect actual calendar read-write use + Gmail draft creation
  (required for Google OAuth verification + basic accuracy). Route to Core.
- **2026-06-09** — **Email drafting feature is code-complete & merged to master,
  green (61/61, tsc clean).** Full pipeline: Core composition (`lib/outreach.ts`)
  → Security guarded draft-only `createDraft` (`lib/gmail.ts` + `lib/google-auth.ts`)
  → `draftEmail` tool wired in `tool-call/route.ts` + `lib/vapi.ts`, undo via
  `deleteDraft`. Resolved the dual-`gmail.ts` collision (Security owns the access
  primitive; Core owns composition in `lib/outreach.ts`). Remaining = go-live
  config (see checklist above): deploy, create the Vapi `draftEmail` tool, user
  re-consents Google.
- **2026-06-09** — User added the all-day tool params (`endDate` on createEvent;
  `newStartDate`/`newEndDate` on moveEvent) in the Vapi dashboard → the multi-day
  all-day fix is now **fully live**, pending a confirming voice-call test.
- **2026-06-09** — Core's first two tickets (multi-day all-day + research-replace)
  **merged to master & verified green** (tsc clean, 33/33 tests). One external
  step remains for the user: add the new tool params (`endDate` on createEvent,
  `newStartDate`/`newEndDate` on moveEvent) in the **Vapi dashboard** — they live
  there, not in the repo. Route degrades safely until then. Email drafting is the
  new top priority (Security Gmail scope gates it).
- **2026-06-09** — Established the PM + two-engineer model. Renamed the features
  lane to **Core** (branch `core`, folder `edg3-core`, `ROADMAP-CORE.md`).
- **2026-06-09** — Split the single roadmap into two lanes governed by this
  constitution. Adopted git-worktree isolation (one folder + branch per lane) and
  small/frequent direct merges to `master`.

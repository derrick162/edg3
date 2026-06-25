# EDG3 Dispatch Board

> **How this works:**
> - Each engineer checks this file every 10 minutes via their loop.
> - Pick up your first `[ ]` item, do the work, mark it `[x] YYYY-MM-DD`, commit + push.
> - PM loop checks git every 10 minutes, merges green branches, and adds next items here.
> - Do NOT pick up items from another lane's section.

---

## 🛠️ Core (Darren) — branch `core`

- [x] 2026-06-24 (Darren) `728fd3e` **R41 T4** — Self-reported energy level tool. (A) Prompt guard: Edge cannot change Whoop indicator — if user says "my energy is low", call `rememberPreference` + acknowledge, never promise a visual update. (B) `setEnergyLevel` tool: `POST /api/energy/level` (`level: 'high'|'medium'|'low'`, `note?`), `energy_log` table, Vapi tool wired in `tool-call/route.ts`, dashboard badge "Self-reported: 🔴 Low · Jun 24" below Whoop card. ⚠️ External: create Vapi tool + paste UUID.

- [x] 2026-06-24 (Darren) `906ed3c` **C1 — Calendar tool reliability audit** — The #1 product issue: calendar tools (createEvent, moveEvent, deleteEvent, editEvent) are not working reliably. Do a systematic audit of every calendar tool handler in `app/api/vapi/tool-call/route.ts`. For each tool: (1) What does a successful call look like in the logs? (2) What are all the failure modes (API error, wrong params, read-only calendar, organizer restriction, recurring scope)? (3) Is the tool returning an honest spoken error on every failure path — no silent failures, no "Done" on error? (4) Is the Google API response being validated before Edge speaks? Create a comprehensive test matrix: for each tool, write tests covering happy path + every failure mode. Fix every gap found.

- [x] 2026-06-24 (Darren) `004234c` **C2 — createEvent reliability** — Specific known issues: (1) Edge sometimes says it created an event without calling the tool at all — tighten the prompt: "You MUST call createEvent and receive a tool result before saying any event was created. Never narrate a creation." (2) Verify `createEvent` handler validates the Google API response and returns a confirmed event ID in the spoken response so Edge can ground its confirmation in a real result. (3) Check that events are always created on the user's primary writable calendar, not a read-only subscribed one. Add a writable-calendar pre-check before every `createEvent` call.

- [x] 2026-06-24 (Darren) `0ea97e4` **C3 — moveEvent reliability** — Specific known issues: (1) Edge confirms a move without the tool result — add `MOVE CONFIRMATION RULE v2`: the spoken confirmation must echo the new time from the tool result, not from what the user said. Example: "Moved — it's now Thursday at 2pm" (from result), NOT "I've moved that to Thursday" (from memory). (2) Recurring scope: when moveEvent returns a recurring-scope question, Edge must stop and ask before re-calling — verify this prompt rule is firing correctly with a test transcript. (3) After a failed moveEvent (403, organizer restriction, API error), Edge must never say it succeeded — audit every error return path.

- [x] 2026-06-24 (Darren) `bea1347` **C4 — deleteEvent + cleanupEvents reliability** — Audit: (1) Does deleteEvent always verify the event exists before confirming deletion? (2) Does it handle the case where the event was already deleted (404 → "already removed" not "couldn't find it")? (3) `cleanupDuplicates` — verify it correctly identifies and removes only true duplicates, not events with similar names at different times. Add tests for the 404 and already-deleted cases.

- [x] 2026-06-24 (Darren) `6bbdaaf` **C5 — Calendar tool prompt tightening** — Read `lib/vapi.ts` calendar section end-to-end. Identify every place where Edge could plausibly skip calling a tool and just narrate an action. Add a global rule at the top of the calendar tools section: "GROUND TRUTH RULE: You never know if a calendar action succeeded until you see the tool result. Do not infer success from the user's request. Do not confirm until you have a result. If you did not call the tool, you did not take the action." Apply to all 8 calendar tools.

- [x] 2026-06-24 (Darren) `eafee43` **C6 — M2-1 unknown entity consolidation** — Known production bug (observed 2026-06-23): when a call names a previously `(unknown)` entity (e.g., "friend with bachelor party" → Patrick), the old `(unknown)` fact is not retired. Fix in `lib/facts.ts` sleep-time consolidation: explicitly check "does any `(unknown)` or vague entity in stored facts now have a name in this call or in the new facts? If so, retire the old one and merge." Also block event-as-entity facts where the event is a property of a person (bachelor party → attribute of Patrick, not its own entity). Tests: (unknown) → named resolution retires old fact; event-as-entity is blocked.

- [x] 2026-06-24 (Darren) `54ca319` **C7 — M4-4 social mental models** — Schema is ready (Vijay shipped `people_models` table). Build: (1) Sleep-time agent in `lib/facts.ts` — after every call, for each person mentioned, upsert their model: goals, communication style, relationship state, last interaction. (2) Briefing injection — when a person appears on tomorrow's calendar, inject their model into the briefing context: "Sarah (CIBC) — last interaction: tense negotiation Jun 20, she responds well to data-first framing." (3) `rememberPreference` — when user says something about a person mid-call ("Patrick is going through a hard time"), update their model immediately. Tests: person mentioned on 3 calls → model updates each time; person on tomorrow's calendar → model appears in briefing.

- [x] 2026-06-24 (Darren) `0691cd0` **C8 — Gratitude call memory integration** — The gratitude call currently doesn't feed memory well. After every gratitude call: (1) Extract people mentioned and update their models in `people_models`. (2) Extract emotional state signals and store as `pattern` facts ("gratitude call June 24: mentioned feeling anxious about runway"). (3) Extract anything the user explicitly wants remembered (the `EXPLICIT REMEMBER REQUESTS` rule should fire here too). Verify `extractAndUpsertFacts` is called with the gratitude transcript post-call — if not, wire it in the webhook handler for gratitude call type.

- [x] 2026-06-24 (Darren) `d7cfcf3` **C9 — Open call tool reliability** — Open calls (user-initiated, non-briefing) should have the same tool reliability as briefing calls. Verify: (1) All calendar tools are available on open calls. (2) The same GROUND TRUTH RULE (C5) applies. (3) `rememberPreference` fires correctly on open calls. (4) Post-call memory pipeline runs for open calls, not just briefing calls. Check the webhook handler — does it run `extractAndUpsertFacts` for `callType === 'open'`? If not, fix it.

---

## 🔒 Security (Vijay) — branch `security`

- [x] 2026-06-24 **S1 — End-to-end test suite** — The pillar QA checklists describe tests that don't exist yet as automated tests. Write them. In `tests/e2e/`: (1) `memory-pipeline.test.ts` — POST mock call-end webhook → verify episode row, ≥1 fact, transcript stored within 5s. (2) `briefing-pipeline.test.ts` — fact extracted → briefing builder called → fact appears in output. (3) `calendar-tools.test.ts` — mock Google API responses → verify each tool handler returns correct spoken response on success AND each failure mode. (4) `inbound-call.test.ts` — POST `assistant-request` webhook with known/unknown/rate-limited number → verify correct assistant config returned. All tests run in preflight. These are integration tests — hit the real DB layer.

- [x] 2026-06-24 **S2 — Web push notifications** _(security `36ce9ba` — subscribe route + sender already existed R14; added sendPushToAllSubscribers + DEGRADED→push in runHealthDigest covering all 3 triggers; +3 tests, 2370 green. ⚠️ part (4) dashboard permission prompt is Core/Design lane.)_ — Health alerts currently only log to Railway (`HEALTH: DEGRADED`). Derrick never sees them unless he checks logs. Add web push: (1) `POST /api/push/subscribe` — stores a Web Push subscription (endpoint + keys) per user in a new `push_subscriptions` table (encrypted). (2) `lib/push.ts` — `sendPushNotification(userId, title, body)` using the `web-push` npm package. (3) Wire into the existing alert paths: call failed → push; health digest DEGRADED → push; failed_webhooks queue non-empty → push. (4) Dashboard: prompt for push permission on first load (non-blocking, dismissible). Tests: mock push subscription → verify notification fires on simulated failure.

- [x] 2026-06-24 **S3 — Multi-user infrastructure prep** _(security `edb815a` — db.ts query audit clean, no cross-user leak (documented in security-audit.md); deletion cascade drift-guarded; admin users +total_facts; scheduler verified multi-user; new isolation test. 2373 green.)_ — Edg3 currently works for one user (Derrick). Before onboarding anyone else: (1) Audit every query in `lib/db.ts` — does every read/write include `WHERE user_id = ?`? Find any that don't. (2) Verify account deletion cascade covers all tables. (3) Add a `users` admin view to `app/api/admin/` — list all users, call counts, last call date, fact counts. (4) Per-user scheduler — verify `lib/scheduler.ts` loops over ALL active users, not just Derrick. If it's hardcoded to one user, fix it. Tests: two mock users, verify no data bleeds between them.

- [x] 2026-06-24 **S4 — OWASP sweep** _(security `e691a42` — SQLi clean (all bound params), auth coverage clean, input validation audited; fixed subscribe length-cap gap +3 tests; documented in security-audit.md. 2376 green.)_ — Targeted security audit: (1) SQL injection: scan all `lib/db.ts` queries — are there any string interpolations into SQL? All queries must use parameterized statements. (2) Input validation: every `POST`/`PATCH` route — is user input validated before it hits the DB? Scan for missing `.trim()`, missing length checks, missing type checks. (3) Auth on every route: scan `app/api/**` — does every route call `getSession()` and return 401 if null? Find any unprotected routes. (4) Write a test for each gap found. Document findings in `content/security-audit.md`.

- [x] 2026-06-24 **S5 — Performance benchmarks** _(security `d45c612` — performance_log table + recentMaxByJob + PERF_TARGETS check in runHealthDigest (slow job → DEGRADED → push); instrumentation hooks added to briefing.ts/callMemory.ts/facts.ts (additive, ⚠️ Core sync down); 4 tests, 2380 green.)_ — Establish baselines before they become problems: (1) Briefing generation time: instrument `lib/briefing.ts` — log total ms from start to final string. Target: <3s. Log to Railway. (2) Memory retrieval time: instrument `currentOpenCallMemoryText` — how long does fact retrieval + ranking take? Target: <500ms. (3) Fact extraction time: instrument `extractAndUpsertFacts` — Haiku call + upsert. Target: <5s. (4) Write these timings to a `performance_log` table (job, durationMs, timestamp). Add a health-digest line: any job exceeding its target in the last 24h → DEGRADED.

- [x] 2026-06-24 **S6 — Litestream activation package** _(security `7aeeba2` — activate-litestream.sh validator + litestream-setup-guide.md + boot S3-reachability check (checkS3Reachable → CRITICAL+push when bucket set but unreachable); 7 tests, 2387 green.)_ — T0-1 code is complete but needs Railway config to activate. Create: (1) `scripts/activate-litestream.sh` — a validation script that checks env vars are set, tests S3 connectivity, verifies the SQLite file path, and prints a clear PASS/FAIL per step. (2) `content/litestream-setup-guide.md` — step-by-step: create Railway volume (persistent, not ephemeral), create S3 bucket, set 4 env vars, verify with the script, run a restore drill. (3) Add a startup check: if `LITESTREAM_S3_BUCKET` is set but S3 is unreachable → log CRITICAL and alert via push (S2). This makes the activation safe and verifiable for Derrick.

- [x] 2026-06-25 **S7 — Scheduler multi-user hardening** _(security `ea76800` — added bounded concurrency (MAX_CONCURRENT_CALLS=5 batches); verified fires-all-users + scheduler_lock double-dial guard + call_attempts already logs intended/actual/outcome (no dup scheduled_calls table); +4 tests, 2391 green.)_ — Verify the scheduler handles multiple users correctly under load: (1) If 10 users all have a 7am call time — does the scheduler fire all 10? Or does it fire once and stop? (2) Add a per-user call queue with a max concurrency of 5 simultaneous outbound calls (Vapi limit). (3) Verify `scheduler_lock` prevents double-dial when Railway restarts mid-call. (4) Add a `scheduled_calls` table that logs every intended fire time + actual fire time + outcome — feeds the health digest. Tests: 3 mock users with same call time → all 3 fire, none double-dial.

- [x] 2026-06-25 **S8 — Rate limit hardening** _(security `5838ca2` — audited buckets (all per-user/IP, none global); added vapiWebhook per-IP ceiling (1000/min, sheds 200) + factExtraction per-user (10/hr); documented in security-audit.md; +4 tests, 2394 green.)_ — Current rate limits were set for single-user testing. Before multi-user: (1) Audit all rate limit buckets in `lib/rateLimit.ts` — are they per-user or global? Any global ones will collapse under load. (2) Vapi webhook rate limiting: add a per-IP rate limit on `/api/vapi/webhook` — Vapi retries can flood it. (3) Memory extraction rate limit: `extractAndUpsertFacts` calls Haiku — if called too frequently per user, costs spike. Add a per-user per-hour limit. (4) Document all limits in `content/security-audit.md`. Tests: hammer a rate-limited endpoint, verify 429 fires at the right threshold.

---

## 🎨 Design (Cam) — branch `design`

- [x] **D20** — Memory tab UI polish — 2026-06-24 (Cam). Confidence display (low=italic+muted, medium=dot, high=none), learned-date timezone fix, category headings `text-xs uppercase tracking-widest`. 2291 green.

- [x] **D21 — Edge score display fix** — 2026-06-24 (Cam). — The Edge score is not displaying correctly on the dashboard and the trend is broken. (1) Find the Edge score component and its data source — what API endpoint feeds it? Check network requests on load. (2) Verify the data is being returned correctly from the API. If the API is returning null/undefined, flag to Darren as a Core bug. If the data is correct but the display is wrong, fix the component. (3) The trend graph is not rendering — check for JS errors in console, check that the history data array is non-empty before rendering. Add a graceful empty state ("trend available after 7 days of data") rather than a broken chart. (4) Verify the score updates correctly after a Whoop sync. Tests: snapshot the component with mock data, verify score + trend both render.

- [x] **D22 — Landing page redesign** — 2026-06-24 (Cam). `app/page.tsx` fully rewritten: memory moat hero, three pillars (Focus/Memory/Energy) glass-cards, `MemoryGrowthVisual` compound bar chart, 3-step how-it-works stepper, social proof placeholder. All auth/waitlist logic preserved. 2326 green.

- [x] **D23 — Onboarding flow redesign** — 2026-06-24 (Cam). Indicator 5→4 steps, warm ProfileStep intro, CalendarStep first-call preview block, PrioritiesStep → "What are you trying to accomplish?", CallTimeStep "standing appointment" framing. All logic preserved. 2326 green.

- [x] **D24 — Call history UI** — 2026-06-24 (Cam). Search input, 20-item pagination + Load more, key moment pills (📅/💡/✓), one-line summary per row, empty search state. 2326 green.

- [x] **D25 — Loading skeletons + empty states** — 2026-06-24 (Cam). Activity tab 5-row `.skeleton` shimmer, memory empty state copy updated, Whoop sidebar nudge when disconnected. 2326 green.

- [x] **D26 — Toast / confirmation system** — 2026-06-24 (Cam). `lib/toast.ts` + `components/ui/Toast.tsx` (slide-in, countdown bar, 3s auto-dismiss, max 3, `role="alert"`). Dashboard wrapped in `<ToastProvider>`, `handleContextSave` fires `showToast`. 2326 green.

- [x] **D27 — PWA setup** — 2026-06-24 (Cam). `public/manifest.json`, `app/layout.tsx` Apple/theme meta tags, `beforeinstallprompt` install banner in dashboard. 2326 green.

- [x] **D28 — Accessibility pass** — 2026-06-24 (Cam). `role="tablist"`, `role="tab"` + `aria-selected`, `role="main"`, `aria-label` on all icon-only buttons, global `button:focus-visible` ring confirmed in `globals.css`. 2326 green.

- [x] **D29 — Animation + transition polish** — 2026-06-24 (Cam). `globals.css`: `fade-in`, `tab-slide-left/right`, `card-lift` hover, `row-expand` smooth height. Dashboard: direction-aware tab slide via `key={activeTab}` wrapper, briefing rows `card-lift`, activity expand uses `row-expand` classes. 2326 green.

- [x] **D30 — Dashboard information architecture review** — 2026-06-24 (Cam). Tab reorder: Today → Briefings → Memory → Focus → Activity → Profile → Help. Typography `text-lg font-bold` consistent; spacing `p-3`/`p-5`/`p-8` hierarchy intentional. No other structural changes needed. 2326 green.

---

## 🐛 QA Findings
_(QA tester fills this section)_

---

## ✅ Completed

- [x] **R41 T0** — Memory date tz fix (`parseDbTimestamp`) — 2026-06-24 (Darren)
- [x] **R41 T1** — Conversation State Engine L3 (`lib/transcriptSignals.ts`) — 2026-06-24 (Darren)
- [x] **R22** — Monthly memory consolidation cron (`lib/scheduler.ts`) — 2026-06-24 (Vijay)
- [x] **R23** — Inbound call `assistant-request` handler — already shipped (Core R23 T2 + Security R18) — 2026-06-24
- [x] **R24** — Add Context card visual polish — 2026-06-24 (Cam)

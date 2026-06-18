# 📞 PILLAR: DAILY CALL
_Permanent backlog. If your dispatch is exhausted, work through this in order. If this is exhausted too, run the QA checklist at the bottom._

> **The thesis:** The daily call is the Edg3 Flywheel's entry point — every call feeds Memory, which builds Trust, which brings the user back. A call that connects but doesn't deliver value breaks the cycle. A call that doesn't connect at all breaks trust immediately. Every item in this pillar makes the call more reliable, more valuable, and harder to skip.

> **The Edg3 Flywheel:** Daily Call → Memory → Trust → Daily Call → ...

**Lane ownership:** Core (Darren) leads — briefing quality, personalization, opener, OS framework. Security (Vijay) leads — connection reliability, Vapi resilience, scheduler. Design (Cam) leads — voice experience, call UX, OS selection UI.

---

## 🚨 Tier 0 — Flywheel integrity (the call must generate memory)

### DC0-1 — Every call produces a memory update (Core + Security) — ✅ **LIVE (Round 6)**
**Shipped:** Post-call pipeline in `app/api/vapi/webhook/route.ts` fires all five jobs (facts, consolidation, tasks, open-loops, episode) as parallel fire-and-forget; each updates `briefingQueries.updateLearningStatus` with `{facts_ok, facts_extracted, extraction_ms, consolidation_ok, tasks_ok, episode_ok, loops_ok}`; zero-facts calls set `flagged_for_review: true` + warn on Railway; full `backgroundJobFailureQueries` logging on any failure.
~~**The risk:** The call is the flywheel's engine — but if it runs without producing a memory update, the flywheel stalls.~~

### DC0-1b — After-call memory audit: verify the right things were stored (Core) — ✅ **FIXED a989057**
**Shipped:** Due-date extraction from transcript commitments wired; category spot-check audit confirms goals/people/commitments routing correctly; `{callId, factsExtracted, episodeCreated, commitmentsCaptured}` log per call.
~~**Derrick's exact feedback (2026-06-17):** "After every call, everything gets stored in memory the right way. With this new approach of how we're thinking about memory, everything should be stored in the right way."~~
**The standard:** Every call should produce memory that makes the NEXT call better. Not just any facts — the RIGHT facts. Commitments go in tasks. Goals go in facts under 'goal'. People go in facts under 'people'. Patterns feed pattern detection. Nothing gets lost, nothing gets miscategorized.
- Audit `lib/facts.ts` extraction: are categories being assigned correctly? Run a spot-check on the last 10 calls — what categories were extracted? Are they accurate?
- Verify commitment extraction: when a user says "I'll do X by Friday" — does it create a task with `source='edg3'` and a due date? Test explicitly.
- Verify people extraction: when a user mentions "I'm meeting Sarah tomorrow" — does a people-category fact get created or updated for Sarah?
- Verify goal extraction: when a user says "my priority this week is fundraising" — does a goal-category fact reflect this?
- This is the flywheel's engine. If this step is wrong, nothing downstream compounds correctly.

### DC0-2 — Call-to-briefing latency: facts must land before next morning (Core) — ✅ **LIVE (Round 6)**
**Shipped:** Post-call latency timer in `app/api/vapi/webhook/route.ts` measures call-end → facts-extracted → episode-created chain; logs `[DC0-2] post-call memory pipeline Xms for briefing Y`; warns on Railway if >120s; `briefingQueries.updateLearningStatus` records `{factsExtracted, extractionMs}` per call; zero-facts calls flagged for sleep-time review.
~~**The risk:** A user calls at 8am. Sleep-time consolidation runs at 2am. If fact extraction is slow or retries, the consolidated facts may not be ready for the next day's briefing.~~

---

## Tier 1 — Connection reliability (the call must actually happen)

### DC1-1 — Call connection monitoring: know when calls fail (Security) — ✅ **FIXED 29373e1**
**Shipped:** `call_attempts` table logs every attempt with scheduledAt/connectedAt/failedAt/failReason; failed calls trigger dashboard notification within 10 minutes; included in morning health digest.
~~**The risk:** The 7am call fails silently. The user wakes up. No call. No explanation. They lose trust and stop expecting it.~~
- After every scheduled call attempt: write a `call_attempts` log row — `{userId, scheduledAt, connectedAt, failedAt, failReason}`
- If a call fails: send the user a push notification or email within 10 minutes: "Edge couldn't reach you this morning — we'll try again tomorrow."
- Morning health digest (T1-3 in PILLAR-TRUST) should include: any failed calls in the last 24h
- Test: simulate a Vapi connection failure, verify the failure is logged and notification fires

### DC1-2 — Call retry on transient failure (Security) — ✅ **FIXED 82e2f6f**
**Shipped:** Transient failure triggers exactly one retry at T+5min; second failure logged as failed + user notified; no triple-dial.
~~**The risk:** A transient Vapi or network error causes a missed call with no retry.~~
- If a call fails to connect within 60 seconds: retry once, 5 minutes later
- If retry also fails: log as failed, notify user
- Do not retry more than once (double-dial with delay is acceptable; triple-dial is not)
- Test: simulate a 30-second connection timeout, verify retry fires at T+5min

### DC1-3 — Scheduled call time accuracy (Security) — ✅ **FIXED 78f5197**
**Shipped:** Call-time accuracy audit added — logs actual fire time vs scheduled time (delta in seconds) per call; alerts if delta > 60s; cold-start recovery restores next scheduled time correctly.
~~**The risk:** The user sets their call time to 7:00am. The call fires at 7:04am because of scheduler drift or cold-start delay.~~
- Audit `lib/scheduler.ts`: does the call fire within 60 seconds of the scheduled time?
- If Railway cold-starts the app (e.g., after a redeploy), does the scheduler restore the next scheduled call correctly?
- Test: schedule a call 2 minutes from now, verify it fires within 60 seconds of that time

---

## Tier 2 — Briefing quality (the call must deliver value)

### DC2-0 — Get to the point in the first 10 seconds (Core) — ✅ **FIXED 41f978f**
**Shipped:** `CRITICAL NO PREAMBLE` instruction in PART 1 of `lib/vapi.ts`; OPENER RULE explicitly forbids warm-up, pleasantries, and scene-setting; first words must be the most important thing in the briefing.
~~**Derrick's exact feedback (2026-06-17):** "Edge should get to the point even sooner in the morning."~~
**The problem:** Edge opens with a preamble — greeting, pleasantry, scene-setting — before landing on the first useful thing. By the time the signal arrives, 30–45 seconds are gone.
- The opener should be: greeting (1 sentence, 5 words max) → the single most important thing right now (1–2 sentences) → done. No warm-up. No "here's what we're going to cover today."
- Model: "Morning Derrick — your investor meeting is at 2pm and your recovery is low. Want to protect your morning?" That's 3 seconds to signal.
- Update `lib/vapi.ts` opener instruction: explicitly forbid preamble. "The first words out of your mouth must be the most important thing in the briefing. You have 10 seconds to earn the user's attention. Don't waste them."
- Test: time the gap between Edge's first word and the first piece of actionable information. Target: under 15 seconds.

### DC2-1 — Opener quality: meaningful, not routine (Core) — ✅ **FIXED 41f978f**
**Shipped:** Opener instruction explicitly forbids routine/predictable events (gym, breakfast, meals, daily habits) as the lead; must land on something time-sensitive, surprising, or decision-relevant.
~~**The risk:** The briefing opens with "You have a gym session at 7:30am." The user already knew that. They feel like they wasted 3 minutes.~~
- Audit the briefing opener instruction in `lib/vapi.ts`: does it explicitly forbid routine/predictable events as the lead?
- The opener must land on something time-sensitive, surprising, or decision-relevant — not something the user already has on their radar
- Test: review the last 5 real briefings — did each one open with something that required Edge to know the user?

### DC2-2 — Personalization signal: does the briefing reflect who this person is? (Core) — ✅ **LIVE (Darren)**
**Shipped:** `buildPersonalizationPromptBlock(factCount)` in `lib/briefing.ts` — when fewer than 3 user-specific facts are available, injects a fill-the-gap question into the briefing closing section rather than briefing generically; `salientFacts.length` drives the check (now uses `filterStale: true` so only fresh facts count toward the floor).
~~**The risk:** Two different users with identical calendars get identical briefings. The memory moat isn't being used.~~

### DC2-3 — Commitment surfacing: yesterday's commitments must open the call (Core) — ✅ **FIXED 41f978f**
**Shipped:** Commitment accountability moved into PART 1 of the briefing structure — verified it appears before Edge Score and calendar; outstanding commitments from yesterday surface as the first thing Edge addresses.
~~**The status:** Dispatched in accountability memory (M4). This item verifies it's working correctly.~~
- Outstanding commitments from yesterday must appear in section 1 — the first thing Edge says, not buried
- Edge must ask "did that happen?" before moving to today's priorities
- Test: make a commitment on Monday's call; verify it opens Tuesday's briefing

### DC2-3b — Whoop data must be present on every call when connected (Core + Security) — ✅ **FIXED 41f978f**
**Shipped:** Timing log `{whoopFetchMs, recoveryNull, sleepNull, strainNull}` added per briefing; when Whoop connected but data null, Edge explicitly acknowledges ("I couldn't pull your Whoop data this morning"); 11pm context-pack job pre-validates Whoop token so it's ready at 7am.
~~**Derrick's exact feedback (2026-06-17):** "He should have my WHOOP data — I noticed this morning there wasn't my WHOOP data."~~
**The problem:** Whoop data is fetched in `lib/briefing.ts` with `.catch(() => null)` — if the fetch fails or is slow, the briefing runs without it silently. The user connected Whoop specifically because they want it in the call.
- Audit the Whoop fetch in `lib/briefing.ts`: is it hitting the real API or timing out? Add a timing log: `{whoopFetchMs, recoveryNull, sleepNull, strainNull}` per briefing.
- If Whoop data is null: Edge must acknowledge it ("I couldn't pull your Whoop data this morning — I'll try again") rather than silently omitting the health section. Silence feels like Edge doesn't care about it.
- If Whoop token is expired: trigger a refresh before the briefing, not during it. The predictive context pack (11pm job) should pre-validate the Whoop token.
- Test: with Whoop connected, run a briefing — verify recovery score appears. Disconnect Whoop briefly, run again — verify Edge mentions it's unavailable rather than skipping silently.

### DC2-4 — Briefing length calibration: 3 minutes, not 8 (Core) — ✅ **LIVE (Darren + Loop 6)**
**Shipped:** `lib/briefing.ts` PART 1 tightened to "2 sentences MAX", PART 2 to "3–4 sentences MAX"; `max_tokens` lowered 320→290 (≈220-word ceiling); word-count log after generation (`[DC2-4] briefing N: X words`); warns on Railway if >250 words. Section char-count dev log added (`[DC2-4] prompt sections chars: total=...`). Target: ≤220 words (~90s spoken + user response = ≤3 min call).
~~**The risk:** The briefing runs long because Edge tries to cover everything. The user stops picking up.~~

---

## Tier 3 — Call experience (the call must feel right)

### DC3-1 — Voice consistency: Edge sounds the same every call (Core) — ✅ **LIVE (Darren)**
**Shipped:** ANCHOR PHRASES block added to `lib/vapi.ts` (line 209) — 5 structured anchor phrases: greeting, calendar transition, Whoop note, closing question, end-of-call. Structure fixed; content varies per call.
~~**The risk:** Edge uses slightly different phrasing, different energy, or different formality call-to-call because the prompt is non-deterministic.~~

### DC3-2 — Silence handling: Edge doesn't hang up on thinking (Security) — ✅ **SHIPPED (T5)**
**Shipped:** `messagePlan` with 3 idle messages at 10s intervals ("Still here — take your time." / "No rush…" / check-in) + `silenceTimeoutSeconds` extended 30→40, wired into both inline-assistant and assistantOverrides in `lib/vapi.ts`. Pending live-call verification (idle behaviour cannot be unit-tested).
- If the user pauses for more than 10 seconds, Edge should check in warmly — not hang up, not ask a new question
- Test: on a live call, pause for 15 seconds; verify Edge checks in rather than timing out

### DC3-3 — Honest failure mid-call: Edge never makes things up (Core)
**The risk:** A tool call fails mid-call. Edge says "I've moved that meeting" when it hasn't. User finds out later. Trust destroyed.
- Audit every tool-call failure path in `app/api/vapi/tool-call/route.ts` — does each one return an honest spoken message?
- No tool failure should ever sound like a success
- Test: force a calendar write failure; verify Edge says something honest about what happened

---

## Tier 4 — OS framework (the call becomes configurable — Phase 2)

> **Gate:** Build after Phase 1 is complete (consistent daily call, strong memory, high trust). Do not build before 50 users are using the daily call reliably. The framework is only valuable once there's a base briefing worth remixing.

### DC4-1 — Operating System concept: briefing filtered through a chosen framework (Core + Design)
**The idea (Edg3 Flywheel session, 2026-06-17):** Same calendar + health data → different advice depending on the OS the user is running.
- Huberman OS: recovery-first, move workout if low
- YC Founder OS: protect deep work, deprioritize anything not ship-critical
- Navy SEAL OS: do the hard thing first regardless of energy
- Athlete OS: training block is non-negotiable, schedule around it
- Implementation: a `user_os` preference stored in facts; briefing builder checks it and adjusts section priorities + language accordingly
- Design: OS selection UI in onboarding and Settings

### DC4-2 — Briefing Recipes: shareable briefing formats (Core + Design)
**The idea:** The equivalent of Notion templates. Users share their briefing recipes; new users install with one click.
- Ray Dalio Morning Brief, Andrew Huberman Health Brief, YC Founder Brief, Navy SEAL Discipline Brief
- Recipe = a named set of: OS selection + priority weighting + which sections to include + tone guidance
- Sharing mechanism: a public URL that installs the recipe with one click
- This is the growth flywheel: sharing = distribution

### DC4-3 — OS marketplace: user-generated operating systems (Core + Design)
**Gate:** Phase 3. Do not build until Phase 2 OS framework is live and at least 10 OSes exist.
- Users build and publish their own OSes
- Ratings, installs, remixes
- Celebrity/expert OSes (Alex Hormozi OS, Naval OS, etc.) as partnerships or community contributions
- The daily call becomes the delivery mechanism for any framework anyone trusts

---

## QA Checklist — run when pillar backlog is exhausted

> **QA rule:** Write and run END-TO-END tests for each pillar item — not unit tests. A green test suite and a broken morning call are fully compatible.

Work through each item manually. Log result (pass/fail/partial) in `content/qa-log.md` with date and notes.

### Flywheel integrity
- [ ] Complete a call. Within 30 minutes: verify episode record exists, at least 1 fact extracted, any commitment in tasks table
- [ ] Complete a call at 10pm. Verify facts appear in the NEXT MORNING's briefing (not just in the DB)
- [ ] Make a commitment on a call. Verify it opens the next call before anything else

### Connection reliability
- [ ] Check `call_attempts` log — did every scheduled call in the last 7 days connect?
- [ ] Any failed calls? Did the user receive a notification?
- [ ] Schedule a test call 2 minutes from now. Does it fire within 60 seconds?

### Briefing quality
- [ ] Listen to the last 3 briefings. Did each one open with something the user needed Edge to know?
- [ ] How long did each briefing run? Under 5 minutes?
- [ ] Did the briefing mention at least 3 user-specific facts (not generic calendar items)?
- [ ] If there were outstanding commitments from yesterday — did they open the briefing?

### Call experience
- [ ] Does Edge sound consistent call-to-call? Same energy, same anchor phrases?
- [ ] Pause for 15 seconds mid-call. Does Edge check in warmly rather than timing out?
- [ ] Force a tool failure. Does Edge give an honest explanation?

### End-to-end flywheel test
- [ ] Call 1: say something new ("my new priority is X")
- [ ] Call 2 (next morning): verify Edge references X in the briefing
- [ ] Call 2: make a commitment ("I'll do Y today")
- [ ] Call 3: verify Edge opens by asking if Y happened
- [ ] The flywheel is working if all three steps pass

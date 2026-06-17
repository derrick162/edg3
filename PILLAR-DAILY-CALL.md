# 📞 PILLAR: DAILY CALL
_Permanent backlog. If your dispatch is exhausted, work through this in order. If this is exhausted too, run the QA checklist at the bottom._

> **The thesis:** The daily call is the Edg3 Flywheel's entry point — every call feeds Memory, which builds Trust, which brings the user back. A call that connects but doesn't deliver value breaks the cycle. A call that doesn't connect at all breaks trust immediately. Every item in this pillar makes the call more reliable, more valuable, and harder to skip.

> **The Edg3 Flywheel:** Daily Call → Memory → Trust → Daily Call → ...

**Lane ownership:** Core (Darren) leads — briefing quality, personalization, opener, OS framework. Security (Vijay) leads — connection reliability, Vapi resilience, scheduler. Design (Cam) leads — voice experience, call UX, OS selection UI.

---

## 🚨 Tier 0 — Flywheel integrity (the call must generate memory)

### DC0-1 — Every call produces a memory update (Core + Security)
**The risk:** The call is the flywheel's engine — but if it runs without producing a memory update, the flywheel stalls. A call that extracts no facts, no episode, no pattern is a missed compounding opportunity.
- After every call: verify (a) at least one fact was extracted or updated, (b) an episode record was created, (c) any explicit commitment the user made is in the tasks table
- If extraction produced zero facts: flag the call for sleep-time review rather than silently passing
- Log per-call: `{callId, userId, factsExtracted, episodeCreated, commitmentsCaptured, extractionMs}`
- This is the single most important thing to get right — without it, the moat doesn't compound
- Test: complete a call where you state a new goal; verify all three outputs exist within 5 minutes

### DC0-2 — Call-to-briefing latency: facts must land before next morning (Core)
**The risk:** A user calls at 8am. Sleep-time consolidation runs at 2am. If fact extraction is slow or retries, the consolidated facts may not be ready for the next day's briefing.
- Audit the pipeline: call ends → transcript stored → facts extracted → sleep-time agent runs → briefing context assembled. What's the worst-case latency at each step?
- Facts must be extracted within 30 minutes of call end (not just eventually)
- Sleep-time consolidation must complete before 5am to be available for a 7am call
- Test: complete a call at 11pm, verify facts are in the briefing the next morning

---

## Tier 1 — Connection reliability (the call must actually happen)

### DC1-1 — Call connection monitoring: know when calls fail (Security)
**The risk:** The 7am call fails silently. The user wakes up. No call. No explanation. They lose trust and stop expecting it.
- After every scheduled call attempt: write a `call_attempts` log row — `{userId, scheduledAt, connectedAt, failedAt, failReason}`
- If a call fails: send the user a push notification or email within 10 minutes: "Edge couldn't reach you this morning — we'll try again tomorrow."
- Morning health digest (T1-3 in PILLAR-TRUST) should include: any failed calls in the last 24h
- Test: simulate a Vapi connection failure, verify the failure is logged and notification fires

### DC1-2 — Call retry on transient failure (Security)
**The risk:** A transient Vapi or network error causes a missed call with no retry.
- If a call fails to connect within 60 seconds: retry once, 5 minutes later
- If retry also fails: log as failed, notify user
- Do not retry more than once (double-dial with delay is acceptable; triple-dial is not)
- Test: simulate a 30-second connection timeout, verify retry fires at T+5min

### DC1-3 — Scheduled call time accuracy (Security)
**The risk:** The user sets their call time to 7:00am. The call fires at 7:04am because of scheduler drift or cold-start delay.
- Audit `lib/scheduler.ts`: does the call fire within 60 seconds of the scheduled time?
- If Railway cold-starts the app (e.g., after a redeploy), does the scheduler restore the next scheduled call correctly?
- Test: schedule a call 2 minutes from now, verify it fires within 60 seconds of that time

---

## Tier 2 — Briefing quality (the call must deliver value)

### DC2-1 — Opener quality: meaningful, not routine (Core)
**The risk:** The briefing opens with "You have a gym session at 7:30am." The user already knew that. They feel like they wasted 3 minutes.
- Audit the briefing opener instruction in `lib/vapi.ts`: does it explicitly forbid routine/predictable events as the lead?
- The opener must land on something time-sensitive, surprising, or decision-relevant — not something the user already has on their radar
- Test: review the last 5 real briefings — did each one open with something that required Edge to know the user?

### DC2-2 — Personalization signal: does the briefing reflect who this person is? (Core)
**The risk:** Two different users with identical calendars get identical briefings. The memory moat isn't being used.
- Audit `lib/briefing.ts` context assembly: how many user-specific facts are injected per briefing? Is there a minimum floor?
- If fewer than 3 user-specific facts are available: Edge should surface a reconfirmation question rather than briefing generically
- Test: compare briefings for two test users with identical calendars but different facts — they must differ meaningfully

### DC2-3 — Commitment surfacing: yesterday's commitments must open the call (Core)
**The status:** Dispatched in accountability memory (M4). This item verifies it's working correctly.
- Outstanding commitments from yesterday must appear in section 1 — the first thing Edge says, not buried
- Edge must ask "did that happen?" before moving to today's priorities
- Test: make a commitment on Monday's call; verify it opens Tuesday's briefing

### DC2-4 — Briefing length calibration: 3 minutes, not 8 (Core)
**The risk:** The briefing runs long because Edge tries to cover everything. The user stops picking up.
- Target: core briefing content (opening + priorities + calendar + closing question) should fit in 3 minutes at normal speech pace (~400 words)
- Audit the briefing prompt for length — is it producing 400-word briefings or 800-word briefings?
- If long: identify which section bloats and tighten the instruction for that section
- Test: time a real briefing end-to-end; if over 5 minutes, identify the longest section and trim

---

## Tier 3 — Call experience (the call must feel right)

### DC3-1 — Voice consistency: Edge sounds the same every call (Security + Core)
**The risk:** Edge uses slightly different phrasing, different energy, or different formality call-to-call because the prompt is non-deterministic.
- Identify 3–5 "anchor phrases" that Edge uses at consistent moments (greeting, transition to calendar, closing question)
- Add them explicitly to `lib/vapi.ts` as required phrasings
- Test: listen to 3 consecutive briefings — does Edge have a consistent voice and rhythm?

### DC3-2 — Silence handling: Edge doesn't hang up on thinking (Security)
**The status:** messagePlan + silenceTimeoutSeconds = 40 already shipped (T5). This item verifies it's working.
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

# Edge — Activation Moment: Copy + Funnel + Metrics
_CoS (Esther) deliverable for specs/activation-moment.md. Covers: screen-by-screen copy,
waitlist→onboarding handoff, activation funnel + success metrics, wave-1 tracking checklist._
_Coordinate: Darren (flow + data), Cam (screens + motion), Kevin (PM) for technical accuracy._
_Last updated: June 18, 2026._

> **Scope note:** This doc covers Screens 0–7 of the NEW activation flow (post-calendar-connect
> through dashboard arrival). It **supersedes** the equivalent screens in `content/onboarding-copy.md`
> for the activation path. `onboarding-copy.md` remains authoritative for Screen 1 (Welcome),
> Screen 2 (Connect calendar), and error/edge-case copy. When the two docs conflict on copy: use
> this doc for anything from Screen 2 (calendar connected) onward. Call-time default: **7:30 AM**.

---

## Part 1 — Screen-by-Screen Copy

### Design notes for Cam

- Mobile-first line lengths — these copy blocks must read at 375px
- The ★ REVEAL and ★ HERO LOOP are the wow moments; everything else is transition
- Priorities appear one by one (stagger ~200ms) with their rationale — the appearance IS the magic
- Respect `prefers-reduced-motion`: if set, show all at once, no stagger
- Loading state should feel like something real is happening, not a spinner — see Screen 2

---

### Screen 0 — Welcome (before calendar connect)

**Header:** Meet Edge.

**Body:**
> Edge is your AI chief of staff. He calls you every morning, reads your calendar, and reshapes your day around what actually matters.
>
> Start by connecting your Google Calendar. It takes 30 seconds — and it's where Edge learns how you actually spend your time.

**CTA:** Connect Google Calendar →

**Trust line (small, below CTA):**
> Edge reads your events and writes changes only when you approve them. Disconnect any time.

**Design note (Cam):** Minimal. One action. No feature list. The trust line handles the objection before it's raised.

---

### Screen 1 — Calendar connected (transition to loading)

_Shown for ~1.5 seconds while derivation starts. Fast enough not to feel like a wait; long enough to register._

**Header:** Connected.

**Body:**
> Edge is reading your calendar now.
> Give it a moment.

**Design note (Cam):** Subtle pulse or shimmer — not a spinner. Feels alive, not loading.

---

### Screen 2 — ★ LOADING STATE ("Edge is learning about you")

_Shown while priority-derivation runs. ~5–10 seconds real time. This screen must feel intentional, not like a spinner._

**Header:** Edge is learning about you.

**Subtext (rotate through 2–3 lines as derivation runs):**

Line 1: "Reading the last few months of your calendar…"
Line 2: "Looking for what you keep coming back to…"
Line 3: "Identifying what's getting your time — and what isn't."

**Design note (Cam):** Rotating subtext gives the impression of actual work happening. Swap lines every ~2.5s. End on line 3 before the reveal. Do NOT show a percentage or progress bar — it sets expectations we can't control.

**Copy principle:** "Reading your last few months" is the honest framing. Don't say "analyzing your data" (clinical) or "processing" (robotic). Edge is *learning*.

---

### Screen 3 — ★ REVEAL ("Here's what I already know about you")

_The wow moment. Priorities appear one by one with rationale. This is the first time a tool has understood this person without them typing anything._

**Header:** Here's what I already know about you.

**Subheader (small, muted):** `[summaryLine from derivation]`
— e.g., "Based on 12 weeks of calendar data + 8 email threads + 3 stated goals"
The `summaryLine` field comes directly from `DerivedPriorityProposal.summaryLine`. Use it verbatim — it's already formatted honestly by the engine.

**Priority cards (appear one by one, ~200ms stagger):**

Each card shows:
- **Priority text** — `DerivedPriority.text`, verb-first, ≤60 chars. e.g., "Extend your runway"
- **Evidence chips** — `DerivedPriority.evidenceTags[]`, 2–3 compact tags rendered as pills.
  e.g., `[14 financial blocks]` `[2 open commitments]` `[stated goal]`
- **Rationale** — `DerivedPriority.rationale`, shown below chips in muted text. 1–2 sentences.

**Example reveal sequence (based on actual engine output format):**

> **Extend your runway**
> `[14 financial blocks]` `[2 open loops]` `[stated goal]`
> _You've consistently blocked financial review time — and have two unresolved commitments in that area._

> **Ship the activation moment**
> `[highest calendar hours]` `[open commitment]`
> _Product and engineering sessions account for your most focused blocks over the past 3 months._

> **Protect recovery and training**
> `[18 gym blocks]` `[preference stated]`
> _You've defended exercise time even in high-demand weeks — a pattern worth reinforcing._

**Footer copy (below all priority cards):**
> These are based on your calendar, not a questionnaire. Edge will use them to frame every morning call and score your week.

**CTA:** These look right → 

**Secondary action:** Let me adjust →

**Design note (Cam):** The secondary action doesn't need to be prominent. Most users will tap "These look right" on the first screen — the tweak flow is for the minority who want to edit. Don't let a tweak CTA undermine the confidence of the reveal.

---

### Screen 3b — THIN DATA FALLBACK

_Triggered when `derivePriorities()` returns `null` (no signal at all — no calendar events, no goal/project facts, no email signal), OR when the returned `priorities.length < 2` (engine found signal but not enough confidence for a full reveal). Darren: wire this exactly to those two conditions._

**Header:** Your calendar is pretty clear.

**Body:**
> Edge doesn't have enough calendar history yet to know what drives your week — but that changes fast.
>
> Answer two quick questions and Edge will have everything it needs to start.

**Question 1:** What's the most important thing you're trying to make progress on right now?

[Free text — placeholder: "Growing the business, getting healthier, a specific project…"]

**Question 2:** Is there anything you're trying to protect time for — something that keeps getting squeezed out?

[Free text — placeholder: "Deep focus, exercise, time with family…"]

**CTA:** That's it. Let's go →

**Design note (Cam):** Two questions, no more. The copy "that's it" is intentional — reassures the user it's quick. No third question.

**Copy principle:** "Doesn't have enough history yet" frames thin data as a timing issue (honest), not a user failing (discouraging). "That changes fast" sets the expectation that Edge will learn.

---

### Screen 4 — ACCEPT / TWEAK

_Shown after the reveal for users who tap "Let me adjust." This is the edit state — most users skip it._

**Header:** Adjust your priorities.

**Body:**
> These are what Edge will optimize your week around. Change them anytime from your dashboard.

**Editable fields (pre-filled with derived priorities):**
1. [Derived anchor 1] — [text input]
2. [Derived anchor 2] — [text input]
3. [Derived anchor 3 or blank] — [text input]

**CTA:** Save and continue →

**Copy note:** Don't say "confirm" (implies they're signing a contract) or "submit" (form language). "Save and continue" is neutral and accurate.

---

### Screen 5 — ★ FIRST HERO LOOP ("Here's what I'd change today")

_The second wow moment. Edge has derived priorities AND read the current day/week. This is the first plan._

**Header:** Here's what I'd change today.

**Subheader:** Based on your priorities and what's on your calendar.

**Plan cards (1–3 items):**

Each card:
- **Action** — e.g., "Block 90 minutes for [Priority 1]"
- **Rationale** — e.g., "No focus time for this is scheduled this week"
- **Change detail** — e.g., "Thursday at 10 AM — your next open focused window"

**Example plan:**

> **Block 90 min for extending your runway**
> _No focus time for this is on your calendar this week_
> Thursday at 10 AM →

> **Move 'Team sync' to protect your morning**
> _It's sitting in your sharpest window (9–10 AM)_
> Thursday at 2 PM →

**Footer copy:**
> Every change is logged. One tap undoes it all.

**CTA (primary):** Make it happen →

**CTA (secondary, small):** Skip for now

**Post-apply copy (shown after tapping "Make it happen"):**

> Done. Those changes are in your Google Calendar.
>
> Your Edge Score: **[N]**

**Design note (Cam):** The Edge Score reveal should feel like a reward — it appears AFTER the plan is applied. This is the first time they see the number. It needs weight: large, confident, not buried.

---

### Screen 5b — POSITIVE STATE (calendar already aligned)

_Shown when derivation reveals priorities + calendar is already well-aligned (high Focus score from the start). Rare but real — some users manage their calendar well._

**Header:** Your calendar looks good.

**Body:**
> Your top priorities already have protected time this week. Edge didn't need to change much.
>
> Your Edge Score: **[N]**

**Subtext:**
> Edge will keep watching. If something shifts, you'll hear about it on your morning call.

**CTA:** Set up my morning call →

---

### Screen 6 — FIRST CALL SETUP

**Header:** When should Edge call you?

**Body:**
> Edge calls you every morning — Monday through Friday. The call takes 5–10 minutes. Pick the time that fits before you start work.

**Time picker:** [Time input — default: 7:30 AM in user's timezone]
_(Note: `content/onboarding-copy.md` also uses 7:30 AM as default. Keep consistent — Cam, use 7:30.)_

**Suggested times (shown below picker):**
> Most people find 7:30–8:30 AM works best — early enough to reshape the day before it starts.

**CTA:** Set call time →

**Skip option (small):** I'll set this later

**Post-confirmation copy:**
> First call: [day], [date] at [time].
>
> Edge will call your number. If you can't answer, your summary lands in the dashboard.

---

### Screen 7 — DASHBOARD ARRIVAL

_First dashboard view. User lands here after completing activation. The state is "primed" — Edge Score visible, priorities set, first call scheduled._

**Ambient copy (appears once, then dismissed):**

> Edge has everything it needs. Your first call is [day] at [time].
>
> Until then — everything Edge knows about you is in the "What Edge knows" tab. You can edit or delete anything there.

**CTA:** Got it

---

## Part 2 — Waitlist → Onboarding Handoff

### The email (sent when a waitlist user is approved)

**Subject:** You're off the waitlist — here's your link

**Body:**

> Hey [NAME],
>
> You're in. Here's your link: [SIGNUP_URL]
>
> A few things before you start:
>
> **It takes about 2 minutes to set up.** Connect your calendar, and Edge will tell you what it already knows about you — before you answer a single question. That's the first thing that usually surprises people.
>
> **The morning call is the product.** Everything else in the app supports it. Pick a time you'll actually pick up — early enough to reshape your day before it starts.
>
> **The first call will feel a little rough.** Edge is still learning you. Give it 3–5 calls before you judge it. That's when it starts to feel like it actually knows how you work.
>
> Questions? Reply here. I read everything.
>
> Derrick

---

### The in-app "You're in" banner (for waitlist users arriving via email link)

_Shown at the top of the welcome screen if the user arrives from a waitlist confirmation link._

**Banner text:**
> Welcome — you're off the waitlist. Let's get started.

**Design note (Cam):** One line. Green or accent-colored. Dismissible. Sets context for why they're here without being loud about it.

---

### If user doesn't complete onboarding within 48 hours (nudge email)

**Subject:** You started — want to finish?

**Body:**

> Hey [NAME],
>
> You connected your calendar — nice. You didn't quite make it to the end.
>
> The bit you haven't seen yet is where Edge tells you what it already figured out about you. Takes about 90 seconds. [Resume here →]
>
> Derrick

**Design note:** Don't say "you didn't finish setup." Say "you haven't seen the interesting part yet." Frame the nudge as something they're missing, not a reminder about a task.

---

## Part 3 — Activation Success Metrics

### Definition: what "activated" means

A user is **activated** when they have:
1. Connected their calendar
2. Seen the derived priorities reveal
3. Accepted or adjusted their priorities (did not abandon on the reveal screen)
4. Applied the first hero-loop plan (tapped "Make it happen" — even if it was a no-op)
5. Scheduled their first morning call

**All five.** A user who did 1–4 but didn't set a call time is not activated — they haven't committed to the daily loop.

---

### The funnel (with target conversion rates)

| Step | Action | Target conversion | What failure looks like |
|---|---|---|---|
| **Step 0** | Waitlist email opened | ≥ 60% | Low open rate = wrong subject line or wrong sender |
| **Step 1** | Landed on welcome screen | ≥ 80% of openers | Drop here = friction in the email link or page load |
| **Step 2** | Connected calendar | ≥ 75% of step 1 | Drop here = trust objection (calendar access feels invasive) |
| **Step 3** | Saw priorities reveal | ≥ 95% of step 2 | Drop here = loading state too long or error in derivation |
| **Step 4** | Accepted (or adjusted) priorities | ≥ 85% of step 3 | Drop here = derived priorities feel wrong or "creepy" |
| **Step 5** | Applied first hero-loop plan | ≥ 70% of step 4 | Drop here = plan doesn't feel credible, or user bails on calendar change |
| **Step 6** | Scheduled morning call | ≥ 80% of step 5 | Drop here = unclear value, wrong time options, or friction in picker |
| **★ Activated** | All 6 steps complete | **≥ 40% of waitlist emails sent** | Below 40% = a step in the funnel is broken |

**The number that matters most:** Step 2 → Step 4. If users connect their calendar, see the reveal, and say "yes, that's me" — the product is working. If they drop between step 3 and 4, the derived priorities are wrong or the reveal feels surveillance-like.

---

### Activation quality metrics (go beyond funnel)

Once a user is activated (all 5 steps done), track:

| Metric | Target (week 1) | Signal |
|---|---|---|
| **Day-1 call taken** | ≥ 75% | Did they actually pick up? |
| **Day-3 call taken** | ≥ 60% | Is the habit forming? |
| **Day-7 retention** | ≥ 80% of activated users | The real stickiness gate |
| **Priorities accurate (user-reported at day-7 check-in)** | ≥ 70% "yes, those were right" | Did derivation work? |
| **Hero-loop applied rate (week 1)** | ≥ 60% of morning calls | Are the plans credible? |

**Why day-7 retention is higher for activated users:** Activation is a filter. Users who complete all 5 steps have already committed to the product once (applying the first plan) — they're more likely to return than users who skipped a step.

---

### What "thin data" looks like in the funnel

If derivation fires the thin-data fallback (Screen 3b — two quick questions):

- Track this separately: what % of new users hit thin-data vs. full reveal?
- Thin-data users should be tracked for:
  - Did they complete the two questions? (target ≥ 85%)
  - Did they proceed to the hero loop? (target ≥ 70%)
  - Day-7 retention vs. full-reveal users (expect ~10% lower — less wow moment; watch the gap)

If thin-data users churn at significantly higher rates, consider improving the question flow or lowering the confidence threshold for the reveal.

---

## Part 4 — Wave-1 Activation Tracking Checklist

_Per-user checklist for Derrick to run after each design partner completes onboarding. Takes 5 minutes._

### [User name] — [Date onboarded]

**Funnel completion:**
- [ ] Calendar connected (confirmed in Railway logs — `calendar_tokens` record created)
- [ ] Saw priorities reveal (OR hit thin-data flow and completed questions)
- [ ] Accepted/adjusted priorities (confirmed via `/api/priorities/accept` log)
- [ ] Applied first hero-loop plan (confirmed via Activity tab — at least 1 calendar action)
- [ ] Scheduled morning call (call time set in dashboard)
- [ ] **ACTIVATED ✅** (all 5 above checked)

**Derivation quality check (ask on day-7 call):**
- [ ] "Were the 2–3 priorities Edge showed you accurate?" → note their answer
- [ ] If NO: what was wrong? (wrong priority entirely, missing key one, or just the wording?)

**First call quality:**
- [ ] First call connected (check Vapi dashboard — status: `ended`, duration ≥ 2 min)
- [ ] Edge Score visible on dashboard after first call
- [ ] Any errors in Railway logs around their call time

**Qualitative (from day-1 check-in message):**
- [ ] Got a reply to "how'd that go?"
- [ ] Reaction: Good / Neutral / Needs follow-up
- [ ] One quote worth logging in `content/beta-user-feedback.md`

---

### Batch tracking table (update weekly)

| User | Cal connected | Saw priorities | Accepted | First plan applied | Call set | Activated | Day-7 retention | Priorities accurate |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

---

## Notes for Darren (Core — flow + data)

1. **Loading copy rotation:** Screen 2 rotates 3 lines of subtext. You'll need to expose a loading state that stays live for at least ~5s — if derivation is faster, hold on the loading screen briefly (300ms minimum after derivation completes) so the transition to the reveal doesn't feel jarring.

2. **Thin-data threshold (verified against `lib/priorityDerivation.ts`):** Show Screen 3b when
   `derivePriorities()` returns `null` (all-empty signal: `!hasCalendar && !hasFacts && !emailSignal`)
   OR when the returned `priorities.length < 2`. Both conditions mean the engine doesn't have
   enough to show a credible multi-priority reveal. DO NOT show Screen 3 with a single priority —
   one card doesn't convey "Edge understands you," it just looks like a guess.

3. **First hero-loop in onboarding context:** The plan cards (Screen 5) show 1–3 items. If `/api/day-plan` returns more, truncate to 3 for onboarding — don't overwhelm. The rest appear on the dashboard after activation.

4. **Post-apply Edge Score:** Score appears after the first plan is applied (Screen 5, post-apply). It needs to be available at this point — even if some components are still calibrating, show what we have.

5. **Thin-data questions write to:** the same fact store as a regular call (preference facts). They feed the first morning call.

---

## Notes for Cam (Design — screens + motion)

1. **The priorities reveal is the ★ moment.** Priorities appear one by one with ~200ms stagger.
   Respect `prefers-reduced-motion` (show all at once, no animation). Each card has three layers:
   - **Priority text** (`DerivedPriority.text`) — large, verb-first, e.g. "Extend your runway"
   - **Evidence chips** (`DerivedPriority.evidenceTags[]`) — 2–3 small pill/badge elements;
     compact and specific, e.g. `[14 financial blocks]` `[2 open loops]`
   - **Rationale** (`DerivedPriority.rationale`) — muted paragraph below chips; 1–2 sentences
   The chips are what makes it feel *earned*, not invented. Size them accordingly.

2. **"These look right" is the primary CTA on Screen 3.** "Let me adjust" is secondary. Size accordingly — 80% of users will tap the primary.

3. **Edge Score reveal on Screen 5 (post-apply)** needs visual weight. First time the user sees their score. Make it feel like a reward, not a stat.

4. **The thin-data screens (3b) use a completely different visual tone** — conversational, light. No reveal animation. Two text inputs, nothing else.

5. **Mobile line lengths:** All copy above should wrap gracefully at 375px. The "here's what I already know about you" header may need to break at "know" on small screens — verify.

6. **The ambient copy on Screen 7 (dashboard arrival)** is the only first-run overlay. It's one banner, dismissible, not a modal. Don't gate the dashboard behind it.

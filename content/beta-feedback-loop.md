# Edge — Beta Feedback Loop
_How we collect, triage, and act on beta feedback. Lightweight — Derrick runs this personally._

---

## Philosophy

Beta feedback is the product's most valuable input. Don't filter it, don't delegate it, don't let it pile up. Derrick reads everything. Routes to Kevin (PM) when it's a product decision. Routes to the engineering lane when it's a bug or feature.

The goal isn't a perfect feedback process. It's: **nothing important gets missed, and users feel heard.**

---

## Channels (in priority order)

1. **Direct email replies** — from the onboarding sequence. Derrick reads and replies personally. Route to PM if it surfaces a product insight; route to Core/Security if it's a bug.

2. **In-app feedback** — triggered prompts after call 5, call 20, and weekly optionally. Routes to `/api/support` → admin dashboard. Kevin reviews weekly.

3. **Direct messages** (Slack, text, LinkedIn) — for design partners who prefer async. Same routing.

4. **Design partner calls** — Derrick personally 30-min call at week 2 and month 1. Unstructured — let them talk. Take notes, route insights.

---

## Weekly cadence (Derrick + Kevin)

**Every Monday — 15 minutes:**
- Derrick: review any email replies from the past week. Flag insights to Kevin.
- Kevin: review in-app feedback from `/api/support`. Categorize: bug / UX friction / missing feature / positive signal.
- Output: a simple list — what came in, what it means, what (if anything) gets routed to a lane.

**No meetings.** This runs async. Kevin posts a Monday summary to the PM session; Derrick reviews when he has a moment.

---

## Triage categories

| Category | What it means | Who handles it |
|---|---|---|
| 🔴 **Bug / broken** | Something isn't working as expected | Route to Core or Security immediately |
| 🟠 **UX friction** | Works but feels bad or confusing | Route to Design; log in ROADMAP-DESIGN.md |
| 🟡 **Missing feature** | "I wish it could..." | PM evaluates; routes if it fits the roadmap |
| 🟢 **Positive signal** | What's working — protect it | Log in this file; don't change what's working |
| ⚪ **Out of scope** | Good idea but not now | Log in IDEAS.md; don't let it derail focus |

---

## What to log (running record — update weekly)

### Positive signals (what's working — protect these)
_Add as they come in._

| Date | User | Signal |
|---|---|---|
| | | |

### Friction / bugs (what's broken)
_Add as they come in; remove when fixed._

| Date | User | Issue | Status |
|---|---|---|---|
| | | | |

### Feature requests (what users want)
_Add as they come in. PM decides if/when to build._

| Date | User | Request | Decision |
|---|---|---|---|
| | | | |

---

## Design partner call guide (week 2 + month 1)

**Structure (30 min):**
- 5 min: how's it going generally? Are you actually using it?
- 10 min: walk me through a recent morning call. What happened?
- 10 min: what's most broken? What's most useful?
- 5 min: who else should be using this?

**What to listen for:**
- Moments of genuine delight ("that was actually useful") — what caused them?
- Moments of friction — where did they have to think too hard?
- Whether the hero loop is landing — "wow my day got better" within 5 minutes
- Whether Edge Score feels meaningful or arbitrary

**After the call:**
- Write 3 bullet notes immediately (before the memory fades)
- Send a 1-line follow-up thanking them and confirming any commitments
- Route insights to Kevin

---

## When to escalate to Derrick directly

Route to Derrick (not just Kevin) when:
- A design partner is churning (stopped using it after week 1)
- A bug is causing real user harm (data lost, call failed, wrong calendar edit)
- A user surfaces an insight that changes the product direction
- A user wants to introduce someone specific (warm referral opportunity)

---

## Success metrics for beta (30-day mark)

- **Retention:** ≥4 of 5 design partners still using Edge at day 30
- **Call streak:** average Momentum score ≥ 60 across design partners
- **Hero loop:** ≥3 unprompted "my day got better" moments across the cohort
- **NPS-equivalent:** "would you recommend Edge to a friend?" — target ≥4/5 saying yes
- **Qualitative:** at least one testimonial quote we can use on the landing page

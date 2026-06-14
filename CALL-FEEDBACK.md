# 📞 EDG3 — Call Feedback Log

> The training loop for Edge. After each call, Derrick drops **"what would have made
> that a 10/10 call"** here (or in chat → the PM logs it). The PM converts each note into
> a concrete fix, and watches for **themes** across calls — that's the real training signal.
> This is the human-in-the-loop substitute for an in-product feedback UI (which we'll build
> once there are real users; parked in `IDEAS.md`).

## How to give feedback
1. **Product / behavior** ("Edge did X wrong, should do Y") → tell the PM in chat → becomes a
   prompt/tool/code fix. Logged below.
2. **Personal style** ("I'd prefer you lead with priorities / be more concise") → just tell
   **Edge on the call** → he stores it as a preference and adapts automatically. (Also worth
   logging a recurring style note here so it survives.)

## Rating shorthand
Each entry: date · what happened · what would've made it a 10 · → resulting fix + status.

---

## 🔁 Recurring themes (highest-signal patterns)

| Theme | What "10/10" looks like | Status |
|---|---|---|
| **Time awareness** | Never suggest a past slot; know the real current time; a delayed/retried call reflects when it's actually heard, not when it was written | ✅ Fixed — past-slot guard + retry regenerates fresh briefing |
| **Moving events** | "Move all my gym this week to 2pm" / "move Tue–Thu to 4pm" just works in one go | 🟡 Partial — prompt now moves day-by-day; **durable fix = batch "move all" tool (pending Vapi tool creation)** |
| **Weekend awareness** | Never propose work on Sat/Sun; defer to "when you're back Monday" | ✅ Guard in place (and Edge self-corrects when reminded) |
| **Name accuracy** | Always "Derrick," never the STT "Derek" — in speech, memory, and transcript | ✅ Fixed — extraction uses profile name + display correction everywhere |
| **Call reliability** | The morning call actually reaches you; if it doesn't, it recovers cleanly | ✅ Fixed — stuck-call retryable, "Call me now" forces, retry regenerates |
| **Honest, decisive tone** | Owns failures plainly, never goes silent, never punts the task back, no robotic jargon | ✅ Fixed (watch for regressions) |
| **Delete confirmations** | A genuine delete confirms cleanly without fumbling tokens | 🔴 Open — confirm-token round-trip still fragile (moveEvent now sidesteps it for reschedules) |

---

## 🗒️ Call log (newest first)

### 2026-06-14 (Sun) — morning briefing + reschedule attempts
- **What happened:** suggested a 9:30–11:15 block at ~11:19 (past); proposed Sunday work;
  couldn't move the planning block to tomorrow; couldn't bulk-move gym/energy events.
- **What would've made it a 10:** know it's late morning and only offer future slots; respect
  that it's Sunday; move events on request without fumbling.
- **→ Fixes:** retry now regenerates a fresh briefing (`79b83a8`); never-suggest-past-slot +
  moveEvent-for-reschedules (`f5d3c8b`); multi-day move guidance (`d5b413d`); stuck-call +
  force-call recovery (`fc6b0cb`, `8c52856`). Durable bulk-move tool still to build.

### 2026-06-13 (Sat) — evening open calls
- **What happened:** said he couldn't see Whoop on open calls; gym recurring-move failed;
  "8 H 59 meters"; went silent / punted after a failure; created duplicate events.
- **→ Fixes:** Whoop on all calls; recurring-all move fix; spoken sleep duration; no-punt /
  no-silence prompt; all-day + timed duplication guards; cleanupDuplicates tool.

---

_Add the next call's note below this line._

# Edge — Beta Weekly Health Check
_10 minutes every Monday morning. Tells you if the beta is working or needs intervention._
_Run this before you do anything else on Mondays during wave-1._

---

## The 3-number check (do this first — 2 minutes)

Open the Railway dashboard. Open the Vapi dashboard. Check these three numbers:

| Number | Where to find it | Target | Action if off |
|---|---|---|---|
| **Calls taken last week** (all active users) | Vapi dashboard → Calls → filter by date | ≥ 4/user/week | See "Low calls" below |
| **Server errors** | Railway → Logs → filter by `ERROR` | 0 new types | See "Server issues" below |
| **Users who opened the app last week** | Railway logs or your analytics setup | All active users | See "Disengagement" below |

If all three numbers are green: the week is healthy. Read the sections below quickly and go build.

If any number is off: work through the relevant scenario.

---

## The 5-question scan (3 minutes)

1. **Did every user's calls connect?**
   - Check Vapi dashboard for any `failed`, `no-answer`, or `busy` call statuses in the past 7 days.
   - A single missed call is fine. Two missed calls for the same user = reach out that day.

2. **Did Edge say anything confidently wrong?**
   - Skim the call transcript summaries (dashboard → Briefings for each user, or check the Vapi call logs).
   - Red flags: wrong event names, wrong dates, wrong people, invented information.
   - If yes: log in `content/beta-user-feedback.md` + route to Core for a fix.

3. **Is the Edge Score moving in the right direction?**
   - Any active user whose score is flat or declining for 7+ days = product problem or habit problem.
   - Check: is the hero loop card appearing and being applied? If Apply rate is 0, the card may be empty or uncredible.

4. **Did any user ask a question or send a message you haven't replied to?**
   - Check email, iMessage, WhatsApp from all active users.
   - Rule: reply same day or within 24h during beta. No exceptions.

5. **Is the priority derivation still looking accurate?**
   - After day 7, ask each user: "Do the priorities Edge showed you still feel right?"
   - If a user says "no, those weren't really me" → that's derivation signal. Log it. Note which ICP archetype they are.

---

## The decision: are we on track?

**Green:** All 3 numbers healthy, all 5 questions clean, no outstanding user messages. ✅
→ Invite the next user (if user N has had 3 successful calls and you're under 5 total).

**Yellow:** One or two flags — a missed call, a score going flat, a message waiting.
→ Resolve before inviting the next user. Write up in `content/beta-user-feedback.md`.

**Red:** Multiple users with call failures, a trust-breaking Edge error, or a user who's gone quiet.
→ Stop inviting. Fix first. A bad second user is worse than a slower wave.

---

## Quick recovery scenarios

### Calls aren't happening (user missing calls repeatedly)

Text them personally:
> "Hey — Edge is ready but I want to make sure it's actually useful for you. What's getting in the way of the morning calls? Happy to reschedule the time or troubleshoot anything."

90% of the time: they picked a call time that turned out to be wrong. Change it.
10% of the time: the product isn't landing. Do a 20-minute call and listen.

---

### Edge said something wrong on a call

1. Note the exact error type (wrong name, wrong event, wrong fact, invented data).
2. Fix the wrong fact in "What Edge knows" immediately if it's a stored fact.
3. Text the user within 2 hours: "Edge got [X] wrong on your call — I've corrected it. Tomorrow will be more accurate."
4. Log the error class in `content/beta-user-feedback.md` under type `🔴 Bug`.
5. If it's a repeating class (e.g., STT misreads names), route to Core for a structural fix.

---

### Server error in Railway logs

1. Note the error type and which endpoint.
2. Check if it affected any user's call (did any call fail around that time?).
3. If it's a new error type: route to Core immediately. If it's a known transient (rare DB timeout), monitor for recurrence.

---

### A user goes quiet (no calls, no replies)

Day 2–3: One text — "Just checking in — did Edge reach you this week?"

Day 5: One more text — "Happy to jump on a quick call and walk through it together if anything's not landing."

Day 7 with no response: They've churned. Send a genuine one-liner:
> "No worries if Edge isn't the right fit right now. If anything changes, the invite's open. Thanks for trying it."

Then note in `content/beta-user-feedback.md` what you know about why. This is useful product signal even if it's uncomfortable.

---

### Hero loop plan is empty (DayPlanCard not showing)

This is a Ticket H gap — means `buildCalendarPlan` returned no actions. Route to Core.
Meanwhile: don't pretend it's fine. If a user says "I don't see a plan today," respond honestly:
> "The planning card is calibrating — it gets better as Edge learns your schedule. The morning call should still have specific suggestions from Edge directly."

---

## Week-by-week targets

Use this as your benchmark. If you're ahead: invite the next user. If you're behind: hold.

| End of week | Target state |
|---|---|
| **Week 1** | 1 user activated, had first call, Edge Score visible, one plan applied |
| **Week 2** | User 1 at ≥4 calls, day-7 check-in done, invite user 2 |
| **Week 3** | Users 1 and 2 both at ≥4 calls/week, at least 1 positive quote logged |
| **Week 4** | 3 users active, derivation accuracy check done for first 2 users |
| **Week 6** | 5 users active, day-14 reviews done for users 1 and 2, first testimonial ask sent |
| **Week 8** | 4/5 users still at ≥3 calls/week (day-30 retention signal) |

---

## The one metric that decides everything

**Day-7 retention: ≥4 of 5 activated users still having daily calls at day 7.**

If this is below 3/5: stop inviting new users and run the recovery protocol above for every churned user before proceeding.

If this is at 4–5/5: the product is working. Begin the waitlist content push (founding story + content calendar). Tell Kevin (PM).

---

_Reference: activation funnel targets in `content/activation-moment-copy.md §Part 3`.
Per-user tracking in `content/beta-user-feedback.md`. Intervention templates in `content/launch-day-runbook.md §Emergency scenarios`._

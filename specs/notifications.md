# In-app notifications — Focus × Energy direction

_Decided with Derrick 2026-06-14._

## Principle
> **Notifications are Edge's voice between calls.** The morning call is the big touchpoint;
> notifications keep the chief-of-staff present the other 23 hours. Every notification must
> ladder up to **focus** or **energy** — "are you getting your focus done?" If it doesn't, it's
> noise and we don't send it. Bias to **few + high-signal** and **actionable** (one tap does the thing).

These are **web-app notifications** (the in-app notification center), NOT SMS/text.

## What we keep
The notification center is generic, reusable plumbing — KEEP it:
- `notifications` table (`id, user_id, type, title, body, read, created_at`; title/body encrypted at rest — can carry PII).
- `notificationQueries` (create / listRecent / unreadCount / markRead / markAllRead).
- `/api/notifications` route + the dashboard bell/center.

We keep the pipe and **swap what flows through it**.

## What we remove (off-vision — email-assistant feature)
The email-reply → calendar chain:
- Reply watching: `watched_threads` table, `lib/replies.ts`, `checkOutreachReplies`, the `checkReplies` Vapi tool.
- The `type:'reply'` notifications.
- The "Book it" endpoint `app/api/calendar/book/route.ts` + its dashboard UI.
- (After removal, also retire the `checkReplies` Vapi dashboard tool ID from `lib/vapi.ts`.)

**Parked (separate decision, do NOT remove in this pass):** outbound `draftEmail`. Logged in IDEAS.md.

## The four notification types (mapped to the vision)
**1. Progress & celebration — OUTCOME layer (the heart).** Plugs into the Focus Scoreboard.
- Milestone checked off → "🎉 Two milestones down on Fundraising this week."
- Focus area completed → a real celebration moment.
- Weekly recap → "8h on Product this week — your strongest yet."

**2. Drift nudges — accountability (OUTCOME).**
- Focus area with ~0h scheduled in N days → "You haven't touched [focus area] this week — want me to block time? [Yes, block it]".
- Calendar drifting to unaligned meetings → one gentle flag.

**3. Edge's proactive actions — transparency & trust (ENGINE).**
- "I moved your deep-work block to your 9–11 peak." / "Recovery's low tomorrow — I lightened your afternoon."
- Each carries a one-tap **Undo**.

**4. Daily-rhythm hooks — the loop (INPUT).**
- Energy not set by mid-morning → "How's your energy today?" with one-tap 🔴🟡🟢 **from the notification**.
- Missed / pre-call → "Missed you this morning — tap for today's plan."

## Actionability is the differentiator
Today's notifications are passive (read → click through). New ones **do the thing in one tap**:
set energy, "yes block it," undo, check off a milestone. The notification center becomes a
**control surface**, not an inbox.

## MVP cut (DECIDED)
Build **Type 1 (celebration)** + **Type 4 energy one-tap** first — they ride directly on the
Focus Scoreboard + energy work already in flight and deliver the "feels good" payoff.
Then **Type 2 (drift nudges)**, then **Type 3 (proactive-action transparency)** once Edge acts
more autonomously.

## Sequencing
Land the **Focus Scoreboard** first (in flight). Then: (a) removal pass (reply + Book-it),
(b) Type 1 celebration producers (fire on milestone/area completion — Core, tied to Scoreboard),
(c) Type 4 energy one-tap (notification + dashboard), (d) Design: actionable notification-center
UI + celebration visual.

## Lane split
- 🛠️ **Core** — producers (celebration on check-off; energy-not-set nudge), the removal of reply/Book-it
  feature code (`lib/replies.ts`, `app/api/calendar/book`, `checkReplies` handler), actionable
  notification endpoints (set-energy-from-notif, block-it, check-off, undo).
- 🔒 **Security** — schema cleanup (retire `watched_threads`; adjust `notifications.type` set),
  keep title/body encryption-at-rest, ensure one-tap action endpoints are auth/idempotent.
- 🎨 **Design** — notification center as a control surface (actionable rows, unread/celebration states),
  globals.css tokens; celebration visual shared with the Focus Scoreboard.

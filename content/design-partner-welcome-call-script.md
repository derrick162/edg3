# Design Partner Welcome Call Script
_20-minute call, run within 30 minutes of user activating (completing onboarding). Video preferred; phone works._
_Goal: make them feel like a collaborator, not a beta tester. Set expectations that protect the relationship._

---

## Before the call (2 minutes of prep)

Check:
- Did they connect their calendar? (If not, skip section 3 and stay at section 2.)
- Did they complete priority derivation? If yes, glance at what Edge surfaced for them — mention 1 of their priorities by name on the call.
- What time did they set for their calls? Note it.

---

## The call

### Opening (2 min) — make it feel human, not a product demo

> "Hey [name] — thanks for taking 20 minutes. I just wanted to make sure you're set up before tomorrow morning and answer any questions."

> "I'm still deep in building this thing, so you're genuinely going to see stuff that's rough. That's actually why I wanted to start with you — I'd rather you tell me something's off than have it go unaddressed."

Pause. Let them respond. Most will say something like "no worries, excited to try it."

---

### Section 1 — What to expect tomorrow morning (3 min)

> "Here's what tomorrow will look like: at [their call time], you'll get a call from Edge — that's the AI that runs your morning brief. It's voice only, like a phone call."

> "The first call will probably be a little rough. Edge is working off your calendar and whatever it picked up from onboarding, but it doesn't know your context yet. So you might get something generic. That's expected."

> "The calls get meaningfully better by day 3–5 once Edge has seen how you talk about your week. So I'd just ask: hang in there through the first two calls even if they feel basic."

> "After the call, the dashboard will show a summary and a day plan. The day plan is the thing I'm most curious for your feedback on — does it feel credible, or does it feel like a generic to-do list?"

---

### Section 2 — What you're building together (3 min)

> "I should be honest about what stage this is. The core loop works — morning calls, priorities, day planning. But a lot of the more nuanced stuff — like Edge really knowing your patterns and pushing back on you appropriately — that takes time and data."

> "The thing I'm trying to figure out with you is: at what point does this become genuinely useful for someone like you, not just interesting? That's the bar I care about."

> "So if you have a call that misses the mark, or Edge says something that feels off — that's actually the most useful thing you can tell me. Even a quick text is enough."

---

### Section 3 — Their priorities (if derived — 5 min)

> "I noticed Edge flagged [priority 1 text] and [priority 2 text] as your top two priorities. Does that feel right to you, or is there something it's missing?"

Listen carefully. This is product research.

If they say it's off:
> "That's really useful — can I ask what it missed? Because the derivation is based on your calendar history, and if it's wrong that tells me something about what we're not reading correctly."

If they say it's right:
> "Good. The calls will reference those a lot — Edge is going to push you to connect your day to those two things. If it starts to feel like nagging rather than useful, tell me."

---

### Section 4 — The feedback loop (3 min)

> "For the next two weeks, I'll check in every few days — probably just a quick text. If I ask how it's going, honest answer only. 'It was fine' doesn't help me."

> "The things I most want to know: did the priority derivation feel accurate? Does the day plan ever feel credible enough that you actually do something differently? And does Edge ever say something that makes you feel seen — not just like a calendar read back at you?"

> "Those three signals are how I know if this is working."

---

### Section 5 — Housekeeping (2 min)

> "A couple of practical things:"

> "Your call time is [their time] — if that ever needs to move, just tell Edge on a call ('can we move to 8 AM tomorrow?') or text me."

> "If Edge says something confidently wrong — wrong name, wrong event, something invented — text me immediately. I want to know so I can fix it before it happens again."

> "And if a call doesn't happen for any reason — Edge got blocked, Twilio issue, whatever — text me and I'll manually kick off a call from the dashboard."

---

### Close (2 min)

> "That's pretty much it. Any questions before tomorrow morning?"

Let them ask. Answer anything honestly, including "I don't know yet."

> "I'm genuinely excited for you to experience this. Even if the first call is basic, I think by day 5 or 6 you'll start to feel something different about how you start your mornings. That's what I'm hoping to show you."

> "Talk soon — and reach out anytime."

---

## After the call — log it

In `content/beta-user-feedback.md`, note:
- Did they confirm the derived priorities were accurate?
- Did they express any concerns or skepticism?
- Any specific context they shared that Edge doesn't know yet (route to Edge via `/memory` or tell Darren)
- Their actual call time
- Any hard constraints ("I'm traveling day 5–7, pause calls")

---

## Common scenarios

**"I'm nervous I won't know what to say to Edge."**
> "Edge does most of the talking in the beginning — it'll brief you on your day and ask you questions. You just respond naturally. If you're not sure what to say, 'yes' and 'sounds right' are valid answers. You'll find your rhythm by day 3."

**"What if I miss a call?"**
> "Edge will just retry the next morning. Missing one call is fine. If you miss a week, text me and we'll figure out if the timing needs to change."

**"My calendar isn't that complete — will Edge have enough to work with?"**
> "Honest answer: the first few calls might be light on specifics. Edge uses what's there and fills in from what you tell it. The more you tell it during calls — 'I have a fundraising meeting next week that isn't in my calendar' — the more useful it gets. Think of the first week as Edge calibrating."

**"Will you be listening to my calls?"**
> "I have access to the transcripts — that's how I debug and improve things. I won't share them with anyone, and you can delete them from the dashboard at any time. I should be upfront about that."

---

_See also: `content/launch-day-runbook.md §T+30` for activation checklist. `content/beta-user-feedback.md` for per-user log._

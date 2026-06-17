# Edge — Wave-1 Launch Runbook
_The exact sequence for inviting the first beta users. Pre-checks, the send, monitoring,
first 48 hours. Last updated: June 18, 2026._

---

## How to use this

Work through this in order. Each section has a gate — don't proceed until the gate is cleared.
Timings are approximate. The goal is a clean, monitored first experience for each user, not speed.

**The rule:** One user at a time. Don't invite user N+1 until user N has had 3 successful calls.

---

## T-72 hours — Pre-launch gate check

Run through these. Every 🔴 blocks. Every 🟡 note for the record. Every ✅ = proceed.

### Systems
- [ ] Make a real test call to your own phone via Vapi dashboard. Does it ring? Does Edge open correctly?
- [ ] Complete the full onboarding flow on a fresh account (new email). Note anything broken.
- [ ] Check the Edge Score appears on the dashboard — all 4 components or "calibrating."
- [ ] Create a calendar event via voice on the test call. Verify it appears in Google Calendar.
- [ ] Undo that event from the Activity tab. Verify it's removed.
- [ ] Connect Gmail on the test account. Verify email signal appears in Activity within 24h.
- [ ] Check Railway: is the app deployed and running? Check the last deployment timestamp.
- [ ] Verify `DATA_ENCRYPTION_KEY` is set on Railway (Settings → Variables).

### Content / comms
- [ ] Read `content/faq.md` §privacy one more time. Does every claim hold up?
- [ ] Confirm `derrick@edg3.ai` (or your email) is sending and receiving reliably. Send yourself a test.
- [ ] Have the Vapi dashboard open in a browser tab — you'll use it to monitor calls.
- [ ] Have the Railway logs view open — you'll use it to catch server errors.

### The 5 names
- [ ] All 5 names confirmed against ICP archetypes. If not: don't launch. Wait until names are decided.
- [ ] Draft the personal invite message for each person (adapt the template in `content/design-partner-outreach-kit.md`).
- [ ] Know the archetype for each person so you can personalize the first call monitoring.

**Gate:** All system checks green + 5 names confirmed → proceed to T-24.

---

## T-24 hours — Prep the first invite

_Do this the afternoon/evening before the first outreach._

### Final readiness check
- [ ] Test call again — does the most recent Edge build sound right? Accurate calendar read?
- [ ] Check that the signup link resolves correctly and the landing page looks right.
- [ ] Make sure the test account you created is deleted (or the email is removed from the
  waitlist) so it doesn't clutter your monitoring.

### Write the first invite

Pick user 1 from your 5 names. Per `content/design-partner-outreach-kit.md`: Slot 2 (ADHD
High-Performer) or Slot 3 (Trusted Skeptic) first.

Draft the personal message now. Don't send yet.

**Template (adapt to the person):**

> Hey [Name],
>
> I've been building something I think you'd actually use. An AI that calls you every morning,
> reads your calendar, and reshapes your day around what matters. The call takes 5–10 minutes.
>
> [One specific sentence about why you're asking them — connects to something real about them.]
>
> I'm bringing in a handful of people before we open it up. No cost. I just want people who'll
> use it and tell me what's wrong with it.
>
> If you're in, I'll set you up this week. Takes about 10 minutes to get started.
>
> Derrick

Send via iMessage or WhatsApp — not email. More personal; faster response.

---

## T-0 — Send the first invite

_Once the message is drafted and you've done the T-24 check:_

**Step 1:** Send the invite message.

**Step 2:** Wait for a "yes." Don't send the signup link until they reply affirmatively. People
who clicked a link without saying yes first have much lower completion rates.

**Step 3:** When they say yes, reply within 30 minutes:

> "Great — here's the link: [signup URL]. Takes about 10 minutes to set up. Pick a call time
> that works for your mornings. Text me if anything doesn't work."

**Step 4:** Note the time they received the link. If they haven't completed onboarding in
48 hours, send one nudge.

---

## T+0 to T+2 hours — Monitor onboarding

Open the Railway logs and watch for their account creation. Signs of success:
- `[users]` record created
- `[calendar_tokens]` record created (calendar connected)
- No 500 errors around their signup time

**If they get stuck:** Text them directly. "How's the setup going? Text me if anything breaks."

**If onboarding completes:** Send a short personal confirmation:
> "You're all set. Edge will call at [their chosen time]. I'll check in after your first call."

---

## Day 1 — First call monitoring

**30 minutes before their call time:** You should be available by phone. Not required to be
in front of a screen, but reachable.

**At call time:** Check the Vapi dashboard — is the call initiated? Is it connecting?

**What a successful call looks like in Vapi:**
- Call status: `ended`
- Duration: 3–12 minutes (< 3 min = something went wrong early; > 12 min = very engaged or Edge was verbose)
- No errors in the call log

**If the call fails to connect:** Text the user immediately:
> "Hey — Edge might not have reached you this morning. Everything okay? I can trigger a call
> manually if you want to try it now."

**30–60 minutes post-call:** Send the first check-in:
> "How'd that go?"

Wait for their answer before deciding anything. Their first words after the first call tell you
a lot about whether the product is working.

---

## Day 1 — Post-call triage

**Good signals:**
- "That was actually useful" / "It moved that meeting I've been avoiding"
- A specific thing Edge did that they noticed
- Questions about how to do more

**Neutral signals:**
- "It was interesting" / "I'll keep an eye on it"
- No specific mention of what happened
- Short response

**Churn signals:**
- "It was a bit confusing" / "I'm not sure I get it"
- "It didn't seem to know about [X]"
- No response to your check-in

**What to do with churn signals:** Call them (voice) within 24 hours. Don't text. "I want to
make sure Edge is useful for you — can we spend 10 minutes walking through it together?" This
is the moment that converts a near-churn into a loyal design partner.

---

## Days 2–3 — Second and third call monitoring

**Day 2:** Check Vapi dashboard — did they take the call? If yes: no action needed. If no:
one text: "Did Edge reach you this morning? Just checking."

**Day 3:** Same check. By day 3, the habit is forming or it isn't.

**If they missed 2 of the first 3 calls:** Call them. "I want to make this worth your time.
What's getting in the way?" You might need to reschedule their call time, or there might be a
product problem.

---

## T+7 days — First formal check-in

**Message:**
> "It's been a week. I'd love your honest read — 20 minutes, whenever works. What's the most
> useful thing Edge has done? What's the most annoying?"

If they're active: schedule the call. If they've gone quiet: one text, then give it 72 hours.

**On the check-in call (20 minutes):**

1. (5 min) What did they think the first week?
2. (5 min) Go through the Activity tab together — do the logged actions match their memory of the calls?
3. (5 min) Go through "What Edge knows" — is anything wrong? Anything they want to correct?
4. (5 min) One "advanced" thing to try in week 2 based on what they told you

**Capture verbatim:**
- The most positive thing they said (potential testimonial — ask permission)
- The most painful thing they described (potential bug or UX fix)

Log everything in `content/beta-user-feedback.md` (create if it doesn't exist yet).

---

## Inviting user 2

**Gate:** User 1 has had at least 3 successful calls AND has had their day-7 check-in.

Repeat the T-24 and T-0 steps above for the second person.

**Note anything you learned from user 1 that changes how you'll introduce Edge to user 2.**
The second invite should be more accurate than the first based on what you now know about how
the product actually works in someone else's hands.

---

## Inviting users 3–5

Same pattern. The gate gets slightly looser as you build confidence:
- User 3: user 2 has had at least 3 successful calls
- Users 4–5: users 3 and 4 are active (calls happening); no major unresolved bugs

---

## The emergency scenarios

### The call fails for multiple users on the same day
- This is a Twilio or Vapi issue, not an individual user problem
- Check the Vapi dashboard for errors across all users
- Post a proactive message to all affected users: "Edge had a technical issue this morning — 
  I'll make sure tomorrow's call goes through. Sorry for the disruption."
- Don't wait for them to notice. Be faster than the problem.

### Edge proposes something confidently wrong
- Monitor call transcripts for the first week
- If Edge said something factually wrong (wrong time, wrong event name, wrong person):
  - Fix the fact in "What Edge knows" manually if possible
  - Text the user: "I noticed Edge said [X] on your call — that's not right, we've corrected it."
  - Log the error type in the feedback doc — if it's a repeating pattern, route to Core

### A user wants to cancel
- Don't fight it. Thank them genuinely.
- Ask one question: "Can I ask what got in the way?" (not why they're canceling — just what)
- The answer is data. Log it.
- If they're open: offer to pause the calls (not cancel the account) and check back in a week

### Server error / outage during beta
- Check Railway status immediately
- Post a message to all active users within 15 minutes: "Edge is down right now — I'm on it.
  [Update in X minutes]."
- Don't go quiet. Silence during an outage is worse than the outage.

---

## Monitoring checklist (daily, week 1)

Each morning, spend 5 minutes:

- [ ] Did all active users' calls connect? (Vapi dashboard)
- [ ] Any server errors in Railway logs from the past 24h?
- [ ] Any user messages that need a response?
- [ ] Edge Score moving in the right direction for active users?

---

## Communication templates for unexpected situations

**Call failed:**
> "Hey — Edge might not have reached you this morning. I'm on it. Do you want me to
> trigger a call now, or pick it back up tomorrow?"

**Edge did something wrong:**
> "I saw Edge [did X] on your call. That's wrong — I've corrected it. Tomorrow's call
> should be more accurate. Sorry for the confusion."

**General issue:**
> "We hit a technical issue this morning — Edge is back up now. Tomorrow's call will go
> through as normal."

---

_Feeds: `content/beta-launch-playbook.md` (the full wave-1 operational plan) and
`content/first-10-users.md` (the three-wave sequential plan)._

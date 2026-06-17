# Edge — Beta Launch Playbook
_Wave 1: 5 design partners → July 2026. Written for Derrick's morning review._
_Last updated: June 18, 2026._

---

## How to read this

This is the operational plan for launching Edge to the first real users. It covers:
1. What has to be true before anyone gets in (hard gates)
2. The exact funnel: how someone goes from "Derrick told me about this" to a live morning call
3. The first-run activation moment — the "whoa, it already knows me" experience
4. The first week: what we do, what they do, what success looks like
5. Success metrics and feedback cadence
6. Blockers that are on Derrick to unblock

Read the gates section first. If a red gate is still red, don't skip ahead.

---

## Part 1 — Go / No-Go Gates

### Hard gates (🔴 = blocks launch)

| Gate | Status | What unblocks it |
|---|---|---|
| **T1 — Fact correction UI** | 🟡 API live; UI in progress (Cam) | Design ships fact-edit inline interaction |
| **T2 — Inbox receipts UI** | 🟡 Backend live; UI in progress (Cam) | Design ships expandable activity rows |
| **Twilio A2P registration** | 🔴 Pending | Derrick follows up / escalates (see §6) |
| **5 design partner names confirmed** | 🔴 Pending | Derrick picks names against ICP archetypes |
| **Onboarding flow testable end-to-end** | 🟡 In progress | Cam completes onboarding screens |

### Soft gates (🟡 = run beta without; required for wave 2)

- Google OAuth verification — limits to ~100 test users; Derrick added manually until verified
- T3 undo toast + score changelog (Ticket H done; wire-up in progress)
- Pricing decision — can run beta free; needed before wave 2 (~10+ users)
- Demo video for Google CASA

### The minimum viable invite moment

Before the first invitation goes out, Derrick should be able to:
1. Click the link from a fresh email → land on the waitlist/signup page
2. Sign up → complete onboarding → connect calendar
3. See the "Here's what I already know about you" activation screen
4. Have a simulated morning call (even manual with Vapi before Twilio clears)
5. See Activity tab → fact in "What Edge knows"

If any of those five steps break: fix it first.

---

## Part 2 — The Waitlist → First Call Funnel

### Step 1: The invite

This is NOT a public launch. These are people Derrick knows personally. The funnel starts with a personal message, not a mass email.

**Channel:** iMessage, WhatsApp, or a short personal email. NOT LinkedIn DM (too formal for this stage). NOT a newsletter blast.

**Message (adapt per person):**

> Hey [Name] — I'm testing Edge with a small group before we open it up. It's a voice AI that calls you every morning, reads your calendar, and helps you focus for the day. Feels different from anything else I've tried.
>
> Would you be one of the first 5? Totally free, takes 10 minutes to set up. I'll send you a link.

**Why this works:** Derrick's personal invite removes the trust threshold. They're saying yes to Derrick, not to an AI product. The "first 5" framing creates exclusivity and commitment.

**Wait for a yes before sending the link.** Don't spray links. You want people who replied "yes" — they're 10x more likely to complete setup than link-clickers.

---

### Step 2: The signup link

Once they say yes, send them to: `https://edg3.ai/signup` (or the current Railway URL if not on custom domain yet).

Before sending, make sure:
- The signup → onboarding flow works without breaking
- The waitlist endpoint at `/api/waitlist` is live (confirmed ✅)
- The calendar OAuth connect works (confirmed ✅)
- Gmail + Whoop prompts during onboarding appear as optional, not required

**What they'll see:**
1. **Welcome screen** — "Edge is your AI chief of staff." One CTA: Get started.
2. **Connect your calendar** — Google Calendar OAuth. Required. Clear why.
3. **Connect your inbox** — Gmail, optional. Explains what Edge reads (subject lines only).
4. **Connect Whoop** — Optional. "If you wear a Whoop, Edge uses your recovery score."
5. **Your focus areas** — Three text inputs. "What are you most trying to make progress on right now?" These seed the Edge Score and the first morning call.
6. **The activation moment** — See §3 below.
7. **Schedule your first call** — Pick a time. Tomorrow morning.

---

### Step 3: The activation moment — "Here's what I already know about you"

This is the most important UX moment in the whole product. It happens immediately after onboarding completes, before the first call. Edge shows what it has already learned — from the calendar and inbox — before saying a single word.

This is the "whoa" moment that converts a skeptic into a believer. It must be specific. Generic is death.

**Copy — full calendar + Gmail connected:**

> Before we even talk, here's what I already know.
>
> **From your calendar:** You have [N] events this week. [Focus area 1] has no protected time — every block is either meetings or personal. I'll fix that on our first call.
>
> **From your inbox:** I found [N] threads that may need your attention, including [one specific example if urgent signal exists — e.g., "a message from your accountant from 3 days ago"].
>
> **Your Edge Score is [N].**
>
> [One-line honest diagnosis — e.g., "Your Focus is strong but Energy is calibrating — you haven't connected Whoop yet." Or: "Focus is low — your top priority has zero calendar time this week."]
>
> Tomorrow morning at [time], I'll call you. We'll spend 10 minutes making this week count.

**Copy — calendar only:**

> From your calendar, I can already see [N] events this week. [Focus area] has no protected time yet.
>
> Your Edge Score is [N]. Tomorrow at [time], I'll call you. We'll fix that.

**Copy — thin calendar (fewer than 5 events):**

> Your calendar is pretty clear this week — which either means you're in a quiet period or you're not putting much there. Tell me on our first call and we'll figure out which.
>
> Your Edge Score is [N]. Tomorrow at [time], I'll call you.

**Design note:** Make the specifics bold or highlighted — "[Focus area]", "[N]", the email example. The scan shouldn't read as a template. It should read as Edge actually knowing something true about this specific person.

---

### Step 4: The first call

The first call is the product. Everything before this is setup.

**What Edge needs to do in the first call:**

1. **Open with the calendar** — name one specific thing that's already there. "You've got a pretty back-loaded Wednesday — four meetings including a two-hour block that runs until 6 PM." This proves it's real.
2. **Acknowledge the focus areas** — "You said extending runway is the priority. I looked at your calendar and there's no time blocked for that this week. Want to fix that right now?"
3. **Offer one concrete action** — create a block, move something, propose a structure. One thing. Not five.
4. **Close with a commitment** — "What's the one thing you'll have done by tomorrow morning's call?" This is the accountability loop.

**Tone for first-time callers:** Warmer, slower, more confirming than usual. They don't know the rhythm yet. Don't rush into the calendar before checking in. "How's the morning going so far?" is fine.

**What can go wrong:**
- Vapi/Twilio call fails to connect — have a fallback (manual call, calendar entry says "text Derrick if Edge doesn't call")
- Edge fumbles the calendar read — happens, and it's recoverable ("Edge got a bit turned around — let me tell you what I actually see")
- User is confused about the format — be patient, explain it's a new thing

**Immediately after the first call:** check the Activity tab together (or in the follow-up message). "Here's what Edge logged from our call." This is the first trust moment.

---

## Part 3 — The First Week Journey

### Day 0 (invite accepted → setup complete)

**User does:**
- Completes onboarding
- Sees activation moment
- Schedules first call for tomorrow

**We do:**
- Send a personal follow-up message (within 2 hours of setup): "You're all set. Edge will call you at [time]. If anything goes sideways, text me."
- Check the internal dashboard to confirm their account looks right (priorities set, calendar connected)

---

### Day 1 (first call)

**User does:**
- Answers the morning call
- Does (or doesn't) one calendar action

**We do:**
- Monitor the call (Vapi dashboard) for failures
- Send a short text or iMessage 30 minutes after: "How'd that go?" — ALWAYS. The first call is fragile. Some people will have loved it. Some will have had a rough call. Both need a response.

**What "good" looks like:**
- They did at least one calendar action on the call
- They said something approximating "that's actually useful"
- They didn't sound confused by the format

---

### Days 2–3 (building the habit)

**User does:**
- Second and third calls
- Begins to form an expectation of what Edge does

**We do:**
- Watch for the pattern: are they showing up for calls? Is the Edge Score moving?
- Day 2 personal text if they went quiet after day 1: "Just checking — did the call go okay yesterday?"

**Watch for early churn signals:**
- They missed a call without rescheduling
- They completed onboarding but haven't had a call yet
- The Activity tab is empty after multiple calls (suggests Edge isn't logging)

---

### Days 4–7 (first meaningful feedback)

**Day 7 check-in:** Send a short personal message or schedule a 20-minute call.

**What to ask:**
1. "What's the most useful thing Edge has done this week?"
2. "What's the most annoying or confusing thing?"
3. "If you had to describe Edge to a friend in one sentence, what would you say?"
4. "Is there anything you expected it to do that it doesn't?"

Don't use a form for this. The first-week check-in should feel like Derrick asking a friend. A form signals "this is feedback collection" — a text or message signals "I actually care."

---

### Day 14 (deeper review)

**If they're still showing up:**
- Schedule a 30-minute video call
- Go through their Activity tab together
- Ask about the Edge Score — does the number feel right?
- Explore one "advanced" use case they haven't tried (Whoop, outreach drafting, memory review)

**If they've gone quiet:**
- One gentle check-in: "Edge misses you. What got in the way?"
- If no response after 72 hours: they've churned for this wave. Note why if known.

---

## Part 4 — Success Metrics (Wave 1)

Wave 1 is 5 design partners. The signal isn't revenue — it's retention, engagement, and authentic "this is different" moments.

### Primary metrics (week 4 baseline)

| Metric | Target | What it means |
|---|---|---|
| **Day-7 retention** | ≥4 of 5 still having daily calls | The product is sticky enough to survive the first week |
| **Avg calls/week (weeks 2–4)** | ≥4 calls/user | Habitual use, not novelty |
| **Avg Edge Score (week 4)** | ≥60 | Edge is actually helping (score goes up = calendar improved) |
| **"Wow" moments** | ≥3 per user across the month | Qualitative signal that Edge did something they couldn't have done alone |
| **Would-recommend score** | ≥4/5 (unprompted question, week 4)** | Net Promoter proxy |
| **Momentum component (4-week trend)** | Positive for ≥3/5 users | Commitment → completion loop working |

### Secondary signals

- **Fact corrections made** — users editing facts = they're reading "What Edge knows" = trust is forming
- **Hero loop Apply rate** — % of day-plan proposals that get applied = are proposals credible?
- **Activity tab views** — are they checking what Edge did? = engagement with transparency
- **Inbox receipt opens** — are they reviewing which emails Edge read? = privacy trust engaged

### What failure looks like

- ≥2 users churn in week 1: the first call is broken, not the product. Fix the call experience before inviting anyone else.
- Edge Score is flat or declining across all users: the score model is broken or the hero loop isn't credible. Escalate to Core.
- Zero fact corrections: either the facts are all right (unlikely) or users don't trust the tab enough to engage. Watch for the trust signal.

---

## Part 5 — Feedback Loop

### The cadence

**Daily (Derrick or automated):**
- Check Vapi dashboard for failed calls
- Check Activity tab for any user who hasn't had a call in 24+ hours
- Respond to any messages from users same-day

**Weekly (Monday):**
- Pull Edge Score trend for all active users
- Review Activity logs: anything surprising?
- Draft a 2-sentence "week in review" for each user (what changed, what to watch)
- Decide if anything is a bug vs. a feature gap vs. a usage pattern

**Ad hoc:**
- Any user message gets a response within 2 hours
- Any call failure gets a personal apology + reschedule within 4 hours

### Triage categories

When feedback comes in, categorize before acting:

| Category | Icon | Response |
|---|---|---|
| **Bug** — something broke | 🔴 | Fix within 24h; notify user when resolved |
| **UX friction** — works but annoying | 🟠 | Log; batch for the week's design review |
| **Missing feature** — "why can't Edge..." | 🟡 | Log; route to Core/Design based on type |
| **Positive signal** — "this was amazing" | 🟢 | Save verbatim; use in positioning + outreach |
| **Out of scope** — "can it also..." | ⚪ | Thank + note; don't commit |

### The feedback document

Keep a running `content/beta-user-feedback.md` (create when first user goes live). One section per user. Each entry: date, verbatim quote or paraphrase, category, action taken.

This becomes the product roadmap for wave 2 and the testimonial source for the broader launch.

---

## Part 6 — Blockers Needing Derrick

These are not engineering problems. They're decisions or actions only Derrick can take.

### 🔴 Hard blockers — nothing moves without these

**1. Twilio A2P registration**

Edge cannot make outbound calls to real users until Twilio's A2P (Application-to-Person) registration is approved. This is a Twilio compliance requirement for US/Canada calling.

Current status: submitted; no response received.

**Action:**
- Today: send a follow-up to Twilio support. Reference the submission confirmation number. Ask for a status update and estimated timeline.
- If no response in 48 hours: escalate to Twilio's business support line or explore an alternative carrier (Vonage, Bandwidth, Plivo — all support Vapi).
- Interim option: Derrick manually initiates calls from Vapi dashboard for the first 1–2 design partners while Twilio clears.

**2. Five design partner names**

The outreach templates are ready (`content/design-partner-outreach-kit.md`). The ICP archetypes are defined (`content/icp-target-profiles.md`). What's missing are the actual names.

Target cohort composition:
- 1 × Type 1 (Recovering Founder) — ICP validation + credible testimonial
- 1 × Type 3 (ADHD High-Performer) — word-of-mouth velocity (ICP1 beachhead)
- 1 × Type 6 (Trusted Skeptic) — honest feedback, strongest testimonial if converted
- 2 × Type 2 or 5 (Overwhelmed Operator or Whole-Life) — breadth signal

**Action:** Derrick fills in names against these archetypes. No names = no outreach = no beta.

---

### 🟡 Soft blockers — can run without, need before wave 2

**3. Google OAuth verification**

Current status: under review. Until approved, Edge can only be used by test users added manually to the Google Cloud project. This caps wave 1 at ~100 users (fine for 5 design partners).

**Action for CASA (video demo):**
- Record a < 5-minute narrated screen recording showing the OAuth flow end-to-end
- Shot-list in `specs/google-verification.md §6` (if not yet written: sign in → connect calendar → grant scope → what Edge does with it → disconnect)
- Upload to the Google CASA submission

**4. Pricing decision**

Beta can run free. The design partners shouldn't pay — they're doing you a favor. But pricing needs to be set before the public waitlist converts into paying users (wave 2, ~10+ users).

Current thinking: $49–$79/month. Not $9.99 — the ICP is buying executive leverage, not a productivity app. Pricing below $49 signals it's in the same category as Notion and Reclaim.

**Options for Derrick's consideration:**
- $49/month — accessible, removes friction for smaller operators + ADHD ICP
- $69/month — mid-range; feels like a "real" tool; still well below EA costs
- $79/month — top of the range; anchors Edge as premium; harder to justify without strong proof
- Free for design partners + charge at wave 2 (recommended for beta)

**Decision needed:** What do wave 1 design partners pay? What does wave 2 start at?

**5. FAQ and trust content review**

The privacy section of `content/faq.md` accurately describes what Edge sees, what's encrypted, and what's stored. Before any user sees it, Derrick should read §"Your data and privacy" and confirm it's accurate and comfortable to his name.

Same for `content/how-edge-protects-you.md` — Vijay (Security) should verify §1–4 before Cam renders it as a live page.

---

## Part 7 — The Day-of-Launch Sequence

When the gates are green and the first user is confirmed, this is the exact sequence:

### T-48 hours
- Confirm Twilio is live (make a test call)
- Run the full onboarding flow as Derrick (fresh account, new email)
- Verify the activation moment renders with real data
- Make sure the user's name will appear correctly on the dashboard

### T-24 hours
- Send the personal invite message (see §2, Step 1)
- Wait for confirmation
- Once confirmed: send the signup link with a short personal note ("Here's the link — takes about 10 minutes. Text me if anything doesn't work.")

### T-0 (day of first call)
- Send a morning reminder text 30 minutes before their call time: "Edge will call at [time]. Talk soon."
- Be available by phone / iMessage for the first 60 minutes in case something breaks

### T+1 hour (post-call)
- Send: "How'd that go?"
- Log any issues in the feedback doc
- Fix anything broken before the next user goes live

### The rule: never invite user N+1 until user N has had a successful first call.

This is discipline. Each user should be a clean, high-quality experience before adding the next. Five messy simultaneous users produces bad data and damages word-of-mouth. Five sequential, well-monitored users produces real signal.

---

## Appendix A — Activation moment copy (all variants)

See `content/onboarding-copy.md §Screen 5` for the full 4-variant activation copy set.

## Appendix B — Outreach templates

See `content/design-partner-outreach-kit.md` for the full initial + follow-up + onboarding + week-1 check-in templates.

## Appendix C — ICP archetypes

See `content/icp-target-profiles.md` for the 4 ICP profiles, and `content/icp-cheat-sheet.md` for the quick-reference discovery guide.

## Appendix D — Trust gates

See `content/beta-launch-checklist.md` for the full trust-pillar go/no-go checklist.

---

_Derrick: the two hard decisions before this playbook can execute are (1) the five names and (2) Twilio status. Everything else is either in progress or in your hands to sign off on. The engineering gates (T1 fact correction UI, T2 inbox receipts) are being built now._

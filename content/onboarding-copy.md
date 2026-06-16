# Edg3 — Onboarding Copy
_First-run narrative v1. For Cam's onboarding flow. CoS draft, June 2026._

---

## Design principle

The onboarding has one job: get the user to their first "whoa" moment as fast as possible. That moment is when Edge tells them something true about themselves that they didn't have to explain. Every screen before that is in service of enabling it.

Minimum friction. Maximum payoff. The user should feel like they're being understood, not processed.

---

## Screen 1 — Welcome

**Headline:**
> Meet Edge.

**Body:**
> Your AI chief of staff. He learns how you work, organizes your calendar around your focus and your energy, and reshapes your day so the things that matter actually get done.
>
> Not another app to manage. A system that manages itself — and gets smarter every morning.

**CTA:** Get started →

---

## Screen 2 — Connect your calendar

**Headline:**
> First, let's see your week.

**Body:**
> Edge works by understanding your calendar — not just what's scheduled, but what it means. Connecting Google Calendar takes 30 seconds and is the foundation for everything Edge does.

**Sub-copy (trust / privacy):**
> Edge reads your calendar to understand your schedule and suggest improvements. It never shares your data or modifies events without your explicit approval.

**CTA:** Connect Google Calendar →

**If already connected:**
> ✓ Calendar connected — Edge can see your schedule.

---

## Screen 3 — Connect additional sources (optional, additive)

**Headline:**
> The more Edge knows, the better he gets.

**Body:**
> Each connection makes Edge smarter. Connect what you have — skip what you don't.

**Cards (shown with connect buttons):**

**Gmail**
> Edge scans for urgent threads, financial signals, and replies that need your attention — so nothing important gets buried.
> *Connect Gmail →*

**Whoop**
> Edge reads your recovery and sleep scores to understand your energy each day — and adjusts your schedule around it.
> *Connect Whoop →*

**Sub-copy:**
> You can add more later. Even with just your calendar, Edge has enough to get started.

**CTA:** Continue →

---

## Screen 4 — Your three areas of focus

**Headline:**
> What are you working toward?

**Body:**
> Edge organizes your calendar around your top three areas of focus — not your task list, not your inbox, but the things that actually matter to you right now.
>
> They can be professional, personal, or both. They'll change over time. For now, just name three.

**Input fields:**
- Area of focus 1 (e.g. "Grow my business", "Get stronger", "Rebuild my finances")
- Area of focus 2
- Area of focus 3

**Sub-copy:**
> Don't overthink it. Edge will help you refine these on your first morning call.

**CTA:** Set my focus areas →

---

## Screen 5 — The Clarity reveal (the "whoa" moment)

**Headline:**
> Here's what Edge already knows about you.

**Body (dynamic — generated from connected sources):**

_If calendar + Gmail + Whoop connected:_
> From your calendar, Edge can see you have **[X] events this week**, including **[meeting type]** and **[focus area match]**. Your schedule suggests you prioritize **[inferred pattern]**.
>
> From Gmail, Edge found **[N] threads that may need attention**, including **[1–2 specific signals if urgent]**.
>
> From Whoop, your recent recovery average is **[score]** — Edge will factor this into your morning recommendations.
>
> Based on your focus areas, Edge has already identified a gap: **[focus area] has no scheduled time this week.** Your first morning call will address this.

_If calendar only:_
> From your calendar, Edge can see you have **[X] events this week**. Based on your focus areas, **[focus area]** has no protected time yet — Edge will propose a fix on your first call.

_Minimal data:_
> Edge is ready to learn. Your first morning call is where it starts — Edge will ask a few questions and begin building your profile.

**Sub-copy:**
> This is just the beginning. Edge gets sharper every morning.

**CTA:** Schedule my first call →

---

## Screen 6 — Schedule your morning call

**Headline:**
> When do you want to talk to Edge?

**Body:**
> Your morning call is 3–5 minutes. Edge opens with your Edge Score, tells you what needs attention today, and reshapes your calendar. Pick a time that works every weekday — you can change it anytime.

**Time selector:** [time picker — default 9:00 AM]

**Sub-copy:**
> Edge will call you at this time, Monday through Friday. If you miss a call, you can catch up in the app.

**CTA:** Set my call time →

---

## Screen 7 — You're set

**Headline:**
> Edge is ready.

**Body:**
> Your first call is scheduled for **[time] tomorrow**. Between now and then, Edge will review your calendar, your focus areas, and everything you've connected — so he can open with something real.
>
> In the meantime, explore your dashboard. Your Edge Score is already running.

**CTA:** Go to my dashboard →

---

## Tone notes for Cam

- Edge is "he" (established brand voice) — consistent throughout
- Never say "AI" or "algorithm" in the user-facing copy — it's Edge, not "our AI system"
- Never use "data" as the subject of a sentence ("your data is safe") — say what Edge does with it instead ("Edge reads your recovery score to...")
- The Clarity reveal (Screen 5) is the emotional peak — give it visual weight. Not a list of permissions granted. A moment of: *"Edge already sees you."*
- Onboarding should feel like meeting a person, not installing software

---

## Error / edge case copy

**Calendar connection failed:**
> Something went wrong connecting your calendar. Try again, or skip for now — you can connect later in Settings.

**No focus areas entered:**
> Edge works best with focus areas set. You can always add them later, but your first call will be more useful if you set three now.

**Call time conflict (event already at that time):**
> Looks like you have something at [time] on [day]. Want to pick a different time, or keep it and Edge will work around it?

**No Whoop / low data:**
> No Whoop connected — Edge will ask about your energy at the start of each call instead. You can connect Whoop anytime in Settings.

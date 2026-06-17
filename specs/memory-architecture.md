# Edge — Memory Architecture (the moat)

_Vision jam with Derrick, 2026-06-17. The strategic core: Edge wins on **context + memory**.
Companion to [`energy-os.md`](energy-os.md) (the daily focus/energy expression) — this doc is the
engine underneath it._

## Mission
Build an AI system that **remembers a user's life better than they do** and uses that memory to improve
decision-making, focus, health, relationships, and long-term goal achievement. Most AI products answer
questions. **Edge helps users make better life decisions.**

## Core insight
Memory is **not** the ability to retrieve information. Memory is the ability to *understand*:
- What matters to the user
- What the user is trying to achieve
- What has happened before
- What patterns keep repeating
- What actions are most likely to improve outcomes

The objective is not a better chatbot. It's a **personal operating system for life.**

## Strategic differentiation
Most AI systems have access only to conversations. Edge combines five streams:
- **Intentions** — Calendar
- **Commitments** — Email
- **Physical state** — Whoop / health data
- **Conversations** — Voice interactions (the daily call)
- **Outcomes** — Observed user behavior (what actually happened)

This cross-source fusion creates an understanding of the user that competitors cannot easily replicate.
**The moat is not the AI model — it's years of structured memory, behavioral understanding, and life
context.**

## The seven memory layers

| # | Layer | Understands | Purpose | Where we stand (2026-06-17) |
|---|---|---|---|---|
| 1 | **State** | Current condition: sleep, recovery, stress, calendar load, email load, energy | Better decisions *today* | ✅ Largely built — Whoop, calendar load, email signal feed the briefing |
| 2 | **Goal** | Active goals across weeks/months/years (launch, health, relationships, income) | Keep daily recs aligned to long-term objectives | ✅ Anchors + weekly priorities + proactive priority-derivation |
| 3 | **Pattern** | Recurring behavior: productive days, distractions, energy cycles, success habits | Coaching from observed reality, not generic advice | 🟡 Partial — Whoop correlations + calendar patterns; deepen |
| 4 | **Decision** | Major decisions + their rationale (product, career, financial, relationship) | Prevent re-litigating decisions; strategic consistency | 🔴 Not built — new |
| 5 | **Relationship** | Evolving understanding of important people (family, colleagues, customers, investors) | Stronger relationships; remember context over time | 🟡 Shallow — facts "People" category; build real profiles |
| 6 | **Narrative** | A coherent life story: transitions, challenges, ambitions | Recs align with the broader life journey, not isolated events | 🔴 Not built — new |
| 7 | **Accountability** | Commitments, predictions, actions, results | Learn from reality; improve future decisions | 🟡 Open-loops + commitment tracking; add outcome recording |

## Product experience
The primary interface is a **short daily voice conversation** — not more dashboards. The user wants
**clarity, prioritization, accountability, guidance.** The daily briefing should answer:
- What matters most today?
- What is at risk?
- What should I focus on?
- What patterns am I missing?
- What action would most improve my life?

(The dashboard is the visible *record* of this memory — "what Edge knows" — which makes the moat
tangible and builds trust. But the voice call is the product.)

## Long-term vision
Not AI productivity software — an **AI Chief of Staff, Coach, and Life Operating System** that
continuously learns what the user values, what drives their success, what creates happiness, what
creates stress, and what leads to better outcomes. Over time Edge becomes increasingly personalized,
increasingly useful, and increasingly **difficult to replace** — because its value comes from
accumulated memory, not model intelligence alone.

## How this directs the build
Every ingestion path (calendar, email, Whoop, call) should **tag and structure** what it sees into these
seven layers — not just store raw text. The richer + more accurate the tagging, the better every
downstream decision (focus, energy, hero loop, briefing). The backend memory/context work plan lives in
[`specs/memory-context.md`](memory-context.md).

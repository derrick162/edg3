# Energy OS — the product's center of gravity

_Vision + MVP, from Derrick's product-direction call 2026-06-14._

## Positioning
> **Edge is the chief of staff that runs your calendar on your energy** — it protects your best
> hours for your most important, highest-energy work, and clears the deck when you're running low.

Every calendar tool schedules by *time*. Almost none schedule by *capacity*. That's the wedge.
This is not a side feature — it should become the core loop and the pitch.

## The model
```
Energy signal (today + week)  ──►  matched against  ──►  Focus areas (each with an energy COST)
        │                                                          │
   Whoop / Oura (auto)                                   "fundraising = high", "admin = low"
   OR manual red/yellow/green                                      │
        └───────────────────────────►  ORCHESTRATION ENGINE  ◄────┘
                                                │
                 Day plan + Week plan + PROACTIVE moves (defer high-energy work off low days)
```

## Building blocks
1. **Universal energy signal (the unlock).** Tiered so it works for EVERYONE, not just wearable
   owners: **auto** from Whoop/Oura (recovery → red/yellow/green), **manual fallback** = Edge asks
   "how's your energy — red, yellow, green?" at call start, and/or a dashboard quick-set.
2. **Energy-cost tags on focus areas.** Each priority tagged high / medium / low energy (set once,
   or learned), so Edge knows what *demands* capacity.
3. **Orchestration engine.** Given today's energy + week outlook + focus-area costs + the calendar:
   day plan (red → protect, low-energy work, defer deep work; green → attack high-energy priority),
   week plan (high-energy work onto high-energy days), and proactive moves with one-tap apply.
4. **Energy as the spine of the morning call.** energy check → energy-optimized plan → "here's
   what I moved and why."

## Seeds that already exist
Whoop recovery + tier mapping (green ≥67 / yellow 34–66 / red ≤33); V2 energy-matched scheduling
(peak/trough); V3 proactive recovery defense + correlations; priority↔calendar alignment;
calendar move/create. The job is elevating these into one coherent loop + the missing pieces.

---

## MVP (build first — cheap validation)
Goal: prove that an energy signal driving day-level calendar moves is valuable — before building
week-optimization, forecasting, or Oura.

1. **Energy signal capture** — a daily energy state {red, yellow, green}:
   - Auto-derive from Whoop recovery when connected (reuse the tier mapping).
   - Manual: Edge asks at call start if no auto signal; + a dashboard quick-set.
   - Store: additive daily record `{ user_id, date, level, source }`.
2. **Focus-area energy cost** — tag each priority high/med/low (dashboard control on priorities,
   and "fundraising is high-energy" learnable via rememberPreference). Additive.
3. **Energy-driven DAY recommendations + proactive moves** — in the briefing + live calls: with
   today's energy + focus-area costs + calendar, recommend what to do, and if a HIGH-energy focus
   block sits on a RED day, proactively offer to move it to a better day → on yes, moveEvent.

### Lane breakdown
- 🛠️ **Core** — signal capture (call question + storage + Whoop-derived), focus-area energy tags,
  the day-recommendation + proactive-move logic (`briefing.ts` + `vapi.ts`), dashboard wiring.
- 🎨 **Design** — the red/yellow/green energy logger, focus-area energy-tag UI, energy-forward
  briefing/dashboard presentation.
- 🔒 **Security** — additive `energy_log` table (+ any schema); nothing beyond existing sensitivity.

### Sequence after MVP
Validate (Derrick is the test case) → week-level optimization → energy forecasting from Whoop/Oura
trends → Oura integration (parked in IDEAS until demand).

## Energy capture flow (DECIDED 2026-06-14)
One daily energy record per user `{ user_id, date, level, source: 'whoop'|'manual'|'override' }`,
shared by the call and the dashboard (set in one place → the other reflects it; never re-ask once set).

**On the briefing call** — energy is captured EARLY (right after the greeting, before the plan) so it
shapes the whole briefing:
- **No Whoop / Whoop empty:** Edge asks once — "Before I run your day, how's your energy: red,
  yellow, or green?" → tailor the briefing to the answer.
- **Whoop present:** don't ask — STATE it ("recovery's green, full capacity") and offer a light
  override ("feel about right, or running lower?"). A subjective override WINS over the Whoop tier
  (felt energy ≠ recovery score); store as source 'override'.
- **Already set today** (dashboard or earlier call): use it, don't re-ask.

**On the dashboard** — a one-tap red/yellow/green setter writing the same daily record. Set before a
call → Edge skips the question and uses it.

## Open decisions
- Default if the user never sets it and there's no Whoop: assume 'yellow' (neutral) vs. ask-only.
- Focus-area energy cost: manual tag first; learned later.
- Positioning shift (messaging/onboarding/pitch) → **Chief of Staff** strategy call.

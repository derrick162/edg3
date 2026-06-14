# Edg3 — Designer Onboarding & Asset Pack

Welcome. This is everything you need to design for Edg3. Read this, then `ROADMAP.md`
(how the team works) and skim `app/globals.css` (the live design system).

---

## 1. What Edg3 is
**An AI Chief of Staff.** It calls the user once a day with a ~2-minute voice **briefing**,
manages their **Google Calendar** (create/move/delete events by voice), **drafts outreach
emails** with the user's real availability (e.g. contacting a plumber), and now **tracks
replies** to those emails and surfaces them in a **notification center**.

**Brand feel:** confident, premium, "Jarvis from Iron Man." Dark, focused, calm — a trusted
advisor, not a busy productivity app. Voice-first; the web app is the control surface.

**Repo:** https://github.com/derrick162/edg3 — Next.js (App Router) + Tailwind v4. All UI is
under `app/`. Design tokens + component classes live in `app/globals.css`.

---

## 2. Live design system (from `app/globals.css` — evolve it, don't replace it)
**Color tokens (`:root`):**
- `--background: #0a0a0f` (near-black) · `--foreground: #e8e8f0` (off-white)
- `--accent: #6366f1` (indigo) · `--accent-glow: rgba(99,102,241,.3)`
- `--card: #111118` · `--card-border: rgba(255,255,255,.06)` · `--muted: #4a4a5a`
- `--success: #10b981` · `--warning: #f59e0b` · `--danger: #ef4444`
- Secondary accent in gradients: **violet `#8b5cf6`**. Info text: `#818cf8`.

**Type:** Inter. Logo uses `.logo-text` (900 weight, tight tracking, white→violet→indigo gradient text).

**Component classes:**
- `.glass-card` (+ `.glass-card-hover`) — the core surface: `#111118`, 1px subtle border, 16px radius, blur.
- `.btn-primary` — indigo→violet gradient, glow shadow. `.btn-secondary` — outline.
- `.input` (+ `textarea.input`) — dark field, indigo focus ring.
- `.badge` + `.badge-success / -pending / -danger / -info`.
- `.orb` / `.orb-1` / `.orb-2` — big blurred background gradient orbs (the ambient glow on every page).
- `.pulse-ring` animation; thin custom scrollbars.

**Net aesthetic:** dark glassmorphism, indigo/violet glow, generous spacing, soft shadows.

---

## 3. Screens to design (all under `app/`)
| Surface | Route / file | Notes |
|---|---|---|
| Landing / marketing | `/` · `app/page.tsx` | First impression; conversion. |
| Sign up / Log in | `/signup`, `/login`, `/admin-login` | Keep friction low. |
| Onboarding | `/onboarding` | Connect Google → set top-3 priorities → profile. First-run flow. |
| **Dashboard** (the main app) | `/dashboard` · `app/dashboard/page.tsx` | Tabs: Briefings, Tasks, Priorities, Memory, Profile. Plus: "Next call" card, **notification bell + panel** (new), calendar connect, "Edge's last change" undo banner. The densest screen — highest design leverage. |
| Privacy / Terms | `/privacy`, `/terms` | Recently updated; low priority visually. |

---

## 4. How design plugs into the team (important)
We run lanes in git worktrees (see `ROADMAP.md`). **UI is the Core lane's surface** (`app/**`,
`app/globals.css`). To avoid collisions:
- **Design direction, tokens, and component specs** → propose changes to `app/globals.css` and the relevant `app/**` files; **coordinate with the Core engineer** (who implements UI) via the constitution's **Status Board** before editing shared files.
- Prefer **token/system-level** changes (in `globals.css`) over one-off inline styles, so the whole app stays consistent. (Heads-up: a lot of current UI uses inline `style={{…}}` — consolidating those into the design system is fair game and welcome.)
- The PM/CTO (me) routes design work and keeps it aligned with the launch goal.

---

## 5. The filter for every design decision
**Ship a TRUSTED, USABLE Edg3 by late August / early September.** So bias toward:
- **Trust:** the UI should make it obvious what Edge did and let users review/undo (notification center, "last change", recent activity).
- **Usability:** mobile matters (users are often mid-call / on the go); clarity over cleverness.
- **Polish that ships**, not a from-scratch redesign. Improve what exists.

If a design idea doesn't materially improve trust or usability for the September launch, it can wait.

---

## 6. Whoop / health recovery visual spec

> For Core to apply when the Whoop V1 integration lands. All classes are live in `app/globals.css`.

### Recovery states
Three states map directly to Whoop's scoring:

| State | Score range | Token | Tint | Border |
|---|---|---|---|---|
| High | 67–100% | `--whoop-high` (#22c55e) | `--whoop-high-tint` | `--whoop-high-border` |
| Medium | 34–66% | `--whoop-medium` (#f59e0b) | `--whoop-medium-tint` | `--whoop-medium-border` |
| Low | 0–33% | `--whoop-low` (#ef4444) | `--whoop-low-tint` | `--whoop-low-border` |

### (a) Briefing card — recovery section
Shows at the top of each briefing card when Whoop is connected. Degrades gracefully (omits entirely if not connected or fetch failed — never show a zero or "--").

```jsx
{/* Recovery pill in briefing header */}
<span className="badge badge-recovery-high">   {/* or -medium / -low */}
  <span className="energy-dot energy-dot-high" />
  Recovery 78%
</span>

{/* Recovery card below the briefing summary */}
<div className="recovery-card recovery-card-high">
  <p className="text-xs font-semibold" style={{ color: 'var(--whoop-high)' }}>
    RECOVERY · 78%
  </p>
  <p className="text-sm mt-1" style={{ color: 'var(--text-body)' }}>
    High recovery day — full capacity for deep work.
  </p>
  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
    Sleep 7h42m · Strain avg: moderate
  </p>
</div>
```

**Copy tone:** state the number + one honest implication. Never invent a number. If strain/sleep is available, show it as supporting detail in muted text.

### (b) Dashboard — recovery widget & Connect button
A compact widget in the Profile tab (or sidebar) showing today's state. Hides when not connected.

```jsx
{/* Recovery widget — shown when connected */}
<div className="recovery-card recovery-card-medium">
  <div className="flex items-center gap-2 mb-1">
    <span className="energy-dot energy-dot-medium" />
    <span className="text-xs font-semibold" style={{ color: 'var(--whoop-medium)' }}>
      Recovery 41%
    </span>
  </div>
  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
    Sleep 5h48m · Keep today lighter.
  </p>
</div>

{/* Connect button — mirrors Google connect control */}
<button className="btn-connect-whoop">
  {/* Whoop logo SVG or "W" glyph, 16px */}
  Connect Whoop
</button>

{/* Connected state */}
<button className="btn-connect-whoop connected">
  ✓ Whoop connected
</button>
```

**Visual placement:** mirror the existing Google Calendar connect control — same row treatment, same visual weight. Don't make it more prominent than Google; it's additive.

### Energy indicator dot
Use inline in text or cards to show state at a glance without a full badge:
- `.energy-dot-high` — glowing green dot
- `.energy-dot-medium` — glowing amber dot
- `.energy-dot-low` — glowing red dot

### V2 north star (energy windows — design placeholder)
When V2 ships (energy-matched time-blocking), the dashboard will show a simple daily energy curve: peak windows (indigo/green) vs. trough (muted). Visual TBD — propose at that time. The current token system (`--whoop-*`) is intentionally designed to extend to this.

---

## 7. RecoveryCard component

**File:** `components/ui/RecoveryCard.tsx`
**Purpose:** Displays today's Whoop recovery data in a self-contained dashboard card. Pure presentational — no data fetching. Core imports it and passes live data from `lib/whoop.ts`.

### Props
| Prop | Type | Required | Notes |
|---|---|---|---|
| `recoveryScore` | `number` | yes | 0–100 Whoop recovery percentage |
| `tier` | `'high' \| 'medium' \| 'low'` | yes | Caller derives: high=67–100, medium=34–66, low=0–33 |
| `sleepHours` | `number` | no | Decimal hours, e.g. `7.5` → formats as `7h30m` |
| `strain` | `number` | no | 0–21 Whoop day strain, rendered to 1 decimal |
| `history` | `RecoveryHistoryPoint[]` | no | Up to 14 points `{score, date}`, newest last — drives sparkline |
| `className` | `string` | no | Extra class names forwarded to the root `<div>` |

### Visual anatomy
1. **Left accent bar** — 3px vertical stripe in `--whoop-{tier}` color
2. **Score** — 36px weight-900 number in tier color + small `%` suffix
3. **Tier label** — `"High / Moderate / Low Recovery"` with glowing energy dot and `"Today"` label
4. **Stats row** — `Sleep` (e.g. `7h30m`) and `Strain` (e.g. `14.2`) side by side in muted uppercase labels
5. **Sparkline** — 14-day SVG trend: area fill + polyline in `--whoop-spark-{tier}` + end-cap dot for today. Falls back to a placeholder bar with helper text if `history` has < 2 points.

### Token reference (sparkline)
```css
--whoop-spark-high:   rgba(34,  197, 94,  0.80);
--whoop-spark-medium: rgba(245, 158, 11,  0.80);
--whoop-spark-low:    rgba(239, 68,  68,  0.80);
--whoop-spark-track:  rgba(255, 255, 255, 0.06);  /* midline grid */
--whoop-spark-dot:    rgba(255, 255, 255, 0.90);  /* unused — reserved */
```

### Card theming
Card background/border come from the existing `.recovery-card`, `--whoop-{tier}-tint`, and `--whoop-{tier}-border` tokens — no new CSS classes needed.

### Integration note for Core
```tsx
import { RecoveryCard } from '@/components/ui';
// tier derivation helper (add to lib/whoop.ts):
// export const recTier = (s: number) => s >= 67 ? 'high' : s >= 34 ? 'medium' : 'low';

<RecoveryCard
  recoveryScore={recovery.score}
  tier={recTier(recovery.score)}
  sleepHours={recovery.sleepHours}
  strain={recovery.strain}
  history={recoveryHistory}
/>
```

---

## 8. FocusScoreboard component

> **The emotional payoff of the product.** Users open the dashboard and instantly see
> whether they're winning at each area of focus. Checking off a milestone feels good.

### Visual structure (per area card)
```
┌─────────────────────────────────────────────────────┐
│  [Ring]  1  Fundraising              ⚡ High energy │
│   68%    6.2h this week · 3/5 milestones            │
│                                                     │
│  ○ Close seed round                                 │
│  ✓ Deck updated         ← checked, strikethrough   │
│  ✓ 5 intro calls done   ← milestone-done bg tint   │
│  + Add milestone                                    │
└─────────────────────────────────────────────────────┘
```

### Progress ring
- 52px SVG ring, 5px stroke, `--score-ring-bg` track.
- Fill color: `--score-fill-low` (<30%) → `--score-fill-mid` (30–69%) → `--score-fill-high` (≥70%) → `--score-fill-done` (complete).
- Smooth CSS transition on `stroke-dasharray` (0.6s ease).
- Progress = 40% time-invested (0–10h → 0–100%) + 60% milestones-done; pure time when no milestones.

### Milestone check-off
- Round checkbox: on check → `--edg-success` border+fill, SVG ✓, row bg → `--score-milestone-done`, text strikethrough. Optimistic UI.
- On check: 🎉 bounces beside row for 1.8s.

### Celebration moments
- **Milestone done**: 🎉 bounce + row tint.
- **Area complete**: card glow (`--score-celebrate-glow`), done-tint bg+border, `✓ done` badge, pulsing ✓ overlay 2s.
- **All areas done**: banner above list in done-tint/glow.

### Prop contract (Core wires data)
```tsx
import { FocusScoreboard } from '@/components/ui';

<FocusScoreboard
  areas={priorities.map(p => ({
    priorityId: p.id, title: p.text,
    hoursThisWeek: alignment[p.id]?.hours ?? 0,
    milestonesDone: milestones.filter(m => m.priority_id === p.id && m.done).length,
    milestonesTotal: milestones.filter(m => m.priority_id === p.id).length,
    isComplete: ..., neglected: alignment[p.id]?.neglected ?? false,
    energyCost: p.energy_cost ?? undefined,
    milestones: milestones.filter(m => m.priority_id === p.id),
  }))}
  onToggleMilestone={async (priorityId, milestoneId, done) => { /* PATCH /api/milestones/:id */ }}
  onAddMilestone={async (priorityId, title) => { /* POST /api/milestones */ }}
/>
```

### Tokens (`app/globals.css` — Focus Scoreboard section)
`--score-ring-bg`, `--score-fill-low/mid/high/done`, `--score-done-tint/border`, `--score-neglected-tint`, `--score-milestone-done`, `--score-celebrate-glow`. Plus `@keyframes pop-in` for the completion ✓.

---

## 9. CalendarFitCard component

> **"Is my calendar set up right?"** — the top half of the Scoreboard surface. Two live 1–10 gauges
> (Focus Score + Energy Score) above the per-area progress section (§8).

### Layout
```
┌─────────────────────────────────────────────┐
│  Calendar fit today              avg: 7/10  │
│  Room to improve — see below.               │
│                                             │
│  🎯 Focus     good            ████████░░  8 ▼│
│     · Focus area "Fundraising" has 0h      │
│     · Only 32% of time is aligned          │
│     ✦ Block 90min for fundraising tomorrow +2│  [Fix it]
│  ─────────────────────────────────────────  │
│  ⚡ Energy    fair            █████░░░░░  5 ▼│
│     · High-demand work in your 2pm trough  │
│     ✦ Move "Deep vibe-coding" to 9am      +3│  [Fix it]
└─────────────────────────────────────────────┘
```

### Score bar
- Thin horizontal bar (h-1.5, rounded, `--gauge-bg` track).
- Fill color ramp: `--gauge-low` (1–3 red) → `--gauge-mid` (4–6 amber) → `--gauge-high` (7–8 indigo) → `--gauge-peak` (9–10 green). Matching glow on fill + score label.
- 700ms CSS width transition on load.

### Interactions
- Each gauge row is a button — tap expands/collapses drivers + top fix.
- **Drivers**: 2–4 short chip-style sentences explaining why the score is what it is.
- **Top fix**: one `✦ action` + `+N points` impact label + optional "Fix it" button that triggers `onRequestFix` (Core wires to the Vapi tool call / API).
- **Calibrating state**: amber banner "Edge is learning your energy — call N of 10" when `calibrating: true`.
- **Loading skeleton**: animated pulse bar while scores compute.

### Prop contract (Core wires data)
```tsx
import { CalendarFitCard } from '@/components/ui';

<CalendarFitCard
  focusScore={{
    score: 8,
    drivers: ['2 focus areas have scheduled time', '68% of blocks are aligned'],
    topFix: { action: 'Block 90min for Fundraising tomorrow', impact: '+1 point' },
  }}
  energyScore={{
    score: 5,
    drivers: ['Deep work sits in your 2pm trough', 'Red recovery day — 3 hard meetings'],
    topFix: { action: 'Move deep vibe-coding to 9am peak', impact: '+3 points' },
    calibrating: false,
  }}
  onRequestFix={type => {
    // type: 'focus' | 'energy'
    // trigger the relevant Vapi tool call or API action
  }}
/>
```

### Tokens added (`app/globals.css` — Calendar Fit gauges)
`--gauge-bg`, `--gauge-low/mid/high/peak`, `--gauge-glow-low/high/peak`, `--gauge-driver-bg`.

---

## 10. First asks (suggested)
1. Audit the **dashboard** and **onboarding** for usability + visual consistency (these are what users touch daily).
2. Propose a tightened **design-token + component** pass in `globals.css` (consolidate the inline styles).
3. Design the **notification center** and the **"Recent activity"** surface (both about user trust — see `ROADMAP-CORE.md`).

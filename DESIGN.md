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

## 6. First asks (suggested)
1. Audit the **dashboard** and **onboarding** for usability + visual consistency (these are what users touch daily).
2. Propose a tightened **design-token + component** pass in `globals.css` (consolidate the inline styles).
3. Design the **notification center** and the **"Recent activity"** surface (both about user trust — see `ROADMAP-CORE.md`).

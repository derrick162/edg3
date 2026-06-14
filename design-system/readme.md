# Edg3 Design System

> Dark, calm, trustworthy. A high-end personal advisor — not a startup app.

**Edg3** (stylized **EDG3**) is a premium AI productivity product. It calls users every
morning for a 3-minute strategic briefing, aligning the day with their priorities and
managing their calendar. The positioning is **"AI Chief of Staff"** — the tagline is
*"Most people have a calendar. You have Edge."* EDG3 stands for **Elite Daily Guidance
Engine**, built for founders, operators, investors and ambitious people who refuse to drift.

The product surface is a single dark web app: a marketing landing page, auth (login /
signup), a four-step onboarding flow, and a dashboard (briefings, tasks, priorities,
memory, profile). The brand should feel like a focused, minimal advisor — every screen
has one job, and the user should feel organized and supported, never overwhelmed.

---

## Sources

This system was reverse-engineered from the product codebase the user attached:

- **`app/`** — the Next.js + Tailwind v4 product (read-only, mounted locally). All visual
  truth was lifted from here, principally `app/globals.css` (CSS variables + the
  `.glass-card` / `.btn-*` / `.badge*` / `.orb` utility classes) and the route pages:
  `app/page.tsx` (landing), `app/login` & `app/signup`, `app/onboarding/page.tsx`
  (4-step wizard), and `app/dashboard/page.tsx` (1,300-line authenticated app shell).

No Figma file, slide deck, or standalone logo asset was provided. The wordmark is
pure CSS gradient text (there is no SVG/PNG logo); only `app/favicon.ico` exists as a
binary brand asset (copied into `assets/`).

---

## Content Fundamentals

**Voice:** A sharp, honest Chief of Staff. Confident, direct, and a little demanding —
the tone of an advisor who respects you enough to tell you the truth. Never cheery,
never apologetic, never corporate-hedgy.

- **Person:** Speaks to the user as **"you"**; the product refers to itself as **Edge**
  / **Edg3** in the first person on calls ("I'll bring that up on our next call").
- **Casing:** Sentence case for almost everything. The wordmark is all-caps **EDG3**;
  short eyebrow labels are ALL-CAPS with wide tracking ("CHAT WITH EDGE", "SUGGESTED BY
  EDG3", "BUILT FOR"). Headlines are sentence case, occasionally with a hard period for
  punch ("Not a productivity app. A strategic advisor.").
- **Punctuation:** Em-dashes for the confrontational aside — *"If you said building your
  startup is priority #1 but your calendar says otherwise — Edg3 will say it."*
  Rhetorical contrast and short declaratives. Numerals stay as digits (3-minute, #1, 8 times).
- **Emoji:** Yes — used as functional iconography (📞 🧠 🎯 📅), not as decoration or
  excitement. One glyph per concept. Never stacked or used for hype.
- **CTAs:** Imperative and aspirational, often with a trailing arrow: "Meet your Chief
  of Staff →", "Call me now", "Complete setup →", "Set priorities & continue →".
- **Vibe examples:** "A 3-minute AI briefing that tells you exactly what deserves your
  attention today." · "Edge tracks patterns you miss." · "Burnout is not a business
  strategy." · "First paying client before first business plan."

**Avoid:** exclamation-mark enthusiasm, "Oops!"/"Whoops!" error cuteness, emoji
confetti, hedging ("you might want to maybe consider"), and superlative praise
("amazing job, superstar!"). See `guidelines/brand-voice.card.html`.

---

## Visual Foundations

**Canvas.** A near-black navy `#0a0a0f` fills every screen. There is no light mode. Depth
is created by two things only: **ambient glow orbs** and **frosted glass cards** — never
by drop shadows.

**Color.** Indigo `#6366f1` is the single primary accent, partnered with violet `#8b5cf6`
for the signature 135° gradient (logo + primary button). Bright indigo `#818cf8` carries
accent *text* on dark. Ink runs in four steps: `#e8e8f0` → `#c8c8d8` → `#888899` →
`#4a4a5a`. Status is conventional: green `#10b981`, amber `#f59e0b`, red `#ef4444`, each
also used at ~15% alpha as a badge tint. See `tokens/colors.css`.

**Type.** One typeface — **Inter** — across the whole system. Tight tracking; heavy
weights for impact (Black 900 for the hero, logo, and numerals; Bold 700 for headings;
Semibold 600 for buttons/labels). The marketing hero runs to 60px; app H1 is 24px; body
is 14px with relaxed 1.65 leading for long-form. Eyebrows are 12px all-caps indigo with
0.08em tracking. Monospace appears only for copy-paste prompt blocks. See
`tokens/typography.css`.

**Ambient orbs.** Two blurred radial gradients sit `position:fixed` behind content: a
600px indigo orb top-right, a 400px violet orb bottom-left, both at `blur(80px)` and low
opacity. Never more than two — restraint is what makes it feel premium rather than
gamer-RGB. See `components/core/Orb.jsx`.

**Glass cards.** The default container: `#111118` fill, a 1px `white 6%` hairline border,
16px radius, 10px backdrop blur, **no shadow at rest**. Interactive cards
(`.glass-card-hover`) gain an indigo border + soft 20px glow on hover. "Edge is speaking"
surfaces get a persistent indigo-tinted border. See `components/core/Card.jsx`.

**Buttons.** Primary = the indigo→violet gradient with a permanent 20px indigo glow that
intensifies and lifts (`translateY(-1px)`) on hover. Secondary = transparent with a
hairline border that tints indigo on hover. Subtle = quiet faint-grey text for tertiary
actions. Radius 10px. Press returns to `translateY(0)`. See `components/core/Button.jsx`.

**Inputs.** Inset `white 4%` fill, hairline border, 10px radius; focus brightens the
border to indigo 50% and adds a 3px indigo 10% ring (no harsh outline). Native selects
use the elevated `#1a1a2e` popover fill with a custom chevron.

**Radii.** 8px chips → 10px buttons/inputs → 16px cards → 18px chat bubbles → 999px pills
(badges, avatars, orbs). Chat bubbles use an asymmetric corner (`18px 18px 4px 18px`).

**Motion.** Calm and quick. 0.2s `cubic-bezier(0.4,0,0.2,1)` for hover/color/border;
0.1s for press feedback. The only looping animation is the 1.5s **pulse ring** on the
live "calling" indicator, plus a slow dot pulse. No bounces, no parallax, no scroll-jacking.

**Hover / press states.** Hover = brighter border + glow (cards/buttons), indigo tint
(secondary button / nav), or opacity shift. Press = the primary button drops its lift.
Quiet text buttons just brighten in color. Destructive actions are red text, not red fills.

**Borders & dividers.** Everything structural is a 1px `white 5–6%` hairline. Section
dividers inside cards are the same hairline. Accent borders are `indigo 30%`.

**Imagery.** None in the product — it is entirely typographic + glass + glow. The mood is
cool, dark, and restrained; if photography is ever introduced, keep it cool-toned and
low-key to match the canvas.

**Layout.** Centered, generous, one-job-per-screen. Auth column 448px, onboarding 512px,
marketing content 1024–1152px, app sidebar 240px. Lots of breathing room (24–32px card
padding, 32px section gaps).

---

## Iconography

Edg3's icon system **is emoji** — there is no custom SVG icon set or icon font in the
codebase. One emoji glyph represents one concept, usually seated in a subtle inset tile or
inline before a label:

- 📞 call · 📋 briefings · ✓ tasks/done · 🎯 priorities · 🧠 memory · 👤 profile
- 📅 calendar · ⚡ misalignment · 🔁 patterns · 🔔 notifications · 💬 open call · 📍 location

Inline **unicode marks** act as lightweight accents: `✦` (Edge suggestion), `→` (CTA /
action), `↩` (undo), `▲ ▼` (expand/collapse), `●` (status dot), `⚠` (carried over).

When building Edg3 artifacts, **use emoji for icons** rather than hand-drawn SVG — it is
on-brand. Keep them sparse and purposeful; emoji are functional here, never decorative.
See `guidelines/brand-iconography.card.html`.

---

## Index / Manifest

**Root**
- `styles.css` — global entry point (import manifest only). Consumers link this one file.
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill wrapper for use in Claude Code.

**`tokens/`** — design tokens, all reachable from `styles.css`
- `fonts.css` — Inter via Google Fonts (see Fonts note below)
- `colors.css` · `typography.css` · `spacing.css` · `effects.css`
- `base.css` — the brand's reusable CSS classes (`.glass-card`, `.btn-primary/-secondary`,
  `.input`, `.badge*`, `.orb*`, `.logo-text`, `.pulse-ring`)

**`components/`** — React primitives (namespace `window.Edg3DesignSystem_b79f44`)
- `core/` — `Button`, `Badge`, `Card`, `Avatar`, `Logo`, `Orb`
- `forms/` — `Input`, `Textarea`, `Select`, `Checkbox`

**`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Brand)

**`ui_kits/app/`** — high-fidelity recreations of the Edg3 product screens (landing,
auth, onboarding, dashboard)

**`assets/`** — `favicon.ico` (only binary brand asset in the source)

---

## Fonts — substitution note

**Inter is the brand's real typeface** (declared in `app/globals.css`). The source app
self-hosts/loads it via Tailwind defaults; here it is loaded from the **Google Fonts CDN**
(`tokens/fonts.css`) so previews render without binary uploads. This is the genuine
font, not a lookalike substitution — but the design-system compiler can't ship a CDN font
as a bundled binary, so it reports **0 fonts**. If you want Inter self-hosted as part of
the system, upload the Inter `.woff2` files and I'll add local `@font-face` rules.

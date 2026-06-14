---
name: edg3-design
description: Use this skill to generate well-branded interfaces and assets for Edg3, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Edg3 in one breath
Dark, calm, trustworthy — a high-end AI "Chief of Staff" that calls you every morning for a 3-minute briefing. Near-black navy canvas, a single indigo→violet accent, frosted glass cards, two ambient glow orbs for depth, Inter type with heavy display weights. The voice is a sharp, honest advisor (never a cheery app). Emoji are the icon system.

## What's here
- `readme.md` — the full design guide: brand context, content/voice fundamentals, visual foundations, iconography, and a file index. **Start here.**
- `styles.css` — the one global stylesheet to link. It `@import`s everything in `tokens/`.
- `tokens/` — colors, typography, spacing, effects, fonts, and the brand's reusable CSS classes (`.glass-card`, `.btn-primary/-secondary`, `.input`, `.badge*`, `.orb*`, `.logo-text`).
- `components/` — React primitives (`core/`: Button, Badge, Card, Avatar, Logo, Orb · `forms/`: Input, Textarea, Select, Checkbox). Each has a `.prompt.md` with usage.
- `guidelines/` — foundation specimen cards (colors, type, spacing, brand).
- `ui_kits/app/` — interactive recreation of the real product (landing → auth → onboarding → dashboard).
- `assets/` — `favicon.ico` (the only binary brand asset in the source).

## Quick rules
- Background is always near-black `#0a0a0f`; there is no light mode.
- Accent is indigo `#6366f1` + violet `#8b5cf6` (135° gradient for logo & primary button). Bright indigo `#818cf8` for accent text.
- Depth = glow + frosted glass, never drop shadows. Two orbs max per page.
- Type is Inter only: Black 900 for hero/logo/numerals, Bold 700 headings, Semibold 600 buttons/labels, body 14px / 1.65.
- Icons are emoji (📞 🧠 🎯 📅 ✓). Don't hand-draw SVG icons.
- Voice: direct, confident, advisor-grade. Sentence case, em-dash asides, no exclamation-mark hype.

## Using the components outside this project
The React primitives reference CSS custom properties — just link `styles.css` and they pick up the brand. In a static HTML artifact, either reuse the `tokens/base.css` classes directly, or load the compiled bundle and read components from the `window.Edg3DesignSystem_*` namespace (see any file in `ui_kits/app/`).

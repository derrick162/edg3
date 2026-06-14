# Edg3 — App UI Kit

A high-fidelity, interactive recreation of the Edg3 product, reverse-engineered from the
attached `app/` codebase. It composes the design-system primitives (`Button`, `Card`,
`Badge`, `Input`, `Select`, `Checkbox`, `Avatar`, `Logo`, `Orb`) — it does **not**
re-implement them.

## Run it

Open `index.html`. It loads `../../styles.css` and the compiled `../../_ds_bundle.js`,
then mounts the flow.

## The flow

`index.html` is a small state machine that walks the real product journey:

1. **Landing** (`LandingScreen.jsx`) — marketing hero, feature grid, "Built for" — from `app/page.tsx`.
   "Get started" → auth (signup); "Log in" → auth (login).
2. **Auth** (`AuthScreen.jsx`) — login / signup card, toggleable — from `app/login` & `app/signup`.
   Signup → onboarding; login → dashboard.
3. **Onboarding** (`OnboardingScreen.jsx`) — the 4-step wizard (Profile · Calendar ·
   Priorities · Call Time) with the step indicator — from `app/onboarding/page.tsx`.
4. **Dashboard** (`DashboardScreen.jsx`) — the authenticated shell: sidebar nav, greeting
   header, "Call me now" (opens the calling modal), the "Chat with Edge" memory box, and
   five working tabs (Briefings, Tasks, Priorities, Memory, Profile) — from
   `app/dashboard/page.tsx`. "Sign out" returns to landing.

## Notes

- All data is fake/seeded; network calls from the source are stubbed to local state.
- Interactions that are real here: route flow, auth toggle, onboarding steps, tab
  switching, task checkboxes, briefing expand/collapse, the chat box, and the call modal.
- Content and copy are lifted from the source to stay on-voice; nothing was invented
  beyond plausible seed data.

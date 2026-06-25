# EDG3 Dispatch Board

> **How this works:**
> - Each engineer checks this file every 10 minutes via their loop.
> - Pick up your first `[ ]` item, do the work, mark it `[x] YYYY-MM-DD`, commit + push.
> - PM loop checks git every 10 minutes, merges green branches, and adds next items here.
> - Do NOT pick up items from another lane's section.

---

## 🛠️ Core (Darren) — branch `core`

_(No pending items — caught up. Loop holding.)_

---

## 🔒 Security (Vijay) — branch `security`

- [ ] **R23** — Inbound call `assistant-request` handler. In `app/api/vapi/webhook/route.ts`, handle `message.type === 'assistant-request'`: look up user by `message.call.customer.number`, return `{ assistant: { ...assistantOverrides } }` with `buildOpenCallSystemPrompt` + memory context. Unknown caller → polite decline, no tools. Must respond within 5s. Tests: known number → personalized config; unknown → decline. Update `ROADMAP-SECURITY.md` changelog.

---

## 🎨 Design (Cam) — branch `design`

- [ ] **D20** — Memory tab UI polish. (1) Fact confidence display: medium = muted dot, low = italic + muted using `--edg-muted` token. (2) "learned [date]" stamps using `new Date(fact.learned_at).toLocaleDateString('en-CA', { month:'short', day:'numeric', timeZone: userTimezone })` — fixes UTC date-flip bug. (3) Category headings: `text-xs font-semibold uppercase tracking-widest --edg-muted mt-6 mb-2`, tokens not inline rgba. (4) Hide empty category sections entirely. `npm run preflight` before push.

---

## ✅ Completed

- [x] **R41 T0** — Memory date tz fix (`parseDbTimestamp`) — 2026-06-24 (Darren)
- [x] **R41 T1** — Conversation State Engine L3 (`lib/transcriptSignals.ts`) — 2026-06-24 (Darren)
- [x] **R41 T4** — Self-reported energy false-confirm fix (`728fd3e`) — 2026-06-24 (Darren). Part B (energy_log + setEnergyLevel Vapi tool + `/api/energy/today`) was already live; shipped Part A prompt guard + dashboard "(self-reported)" label. No external Vapi step needed.
- [x] **R22** — Monthly memory consolidation cron (`lib/scheduler.ts`) — 2026-06-24 (Vijay)
- [x] **R24** — Add Context card visual polish — 2026-06-24 (Cam)

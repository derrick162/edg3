# Spec — "You control your data" onboarding screen

_Proposed 2026-06-14 (Derrick). Inspired by Wispr Flow's data-consent screen._

## Goal
An onboarding step (and matching Settings panel) that gives the user explicit, plain-English
control over how their data is used — building trust and satisfying Google OAuth verification /
CASA expectations around data handling + user control.

## ⚠️ Critical adaptation — Edge is NOT a dictation app
Flow can offer "Privacy Mode = nothing stored" because dictation is stateless. **Edge is a
Chief of Staff with memory** — it MUST store calls, transcripts, priorities, and facts to
function (continuity is the product). So we must NOT promise "nothing is stored." Promising
that would be false and break memory/briefings.

Instead, the choice is about **training/product-improvement use**, not storage-for-function:

| Option | Meaning (honest) |
|---|---|
| **Help improve Edg3** (opt-in) | Your calls, transcripts, and edits may be used to evaluate, train, and improve Edg3's features and AI models. |
| **Privacy Mode** | Your data is used **only to power your own experience** (memory, briefings, scheduling). It is **never used for training/improvement and never shared with any third party.** Encrypted at rest; exportable and deletable anytime. |

Default: TBD with Derrick (lean Privacy Mode ON / improve OFF by default = most trustworthy;
or improve ON with clear opt-out). Footer: "You can always change this in Settings."

## Lane breakdown
- **🎨 Design** — the screen (mirror the reference layout: title "You control your data", two
  cards, lock icon on Privacy Mode, Continue). EDG3 copy above. Plus the Settings-panel version.
- **🛠️ Core** — onboarding step wiring + persist the choice (new `users` column e.g.
  `data_consent` / `privacy_mode`, additive). A Settings toggle to change later. Surface the
  setting to whatever code branches on it.
- **🔒 Security** — the part that makes it TRUE: enforce the choice in data handling. When
  Privacy Mode is on, the user's data must be genuinely excluded from any training/improvement
  pathway and never sent to third parties. Document for CASA. Coordinates with the existing
  encryption-at-rest + data export/deletion work.

## Acceptance
- New users see the screen in onboarding; choice persists; changeable in Settings.
- Privacy Mode is genuinely honored end-to-end (not just UI) — verifiable by Security.
- Copy is accurate to how Edge actually works (no "nothing stored" promise).
- Privacy policy + CASA docs reflect the control.

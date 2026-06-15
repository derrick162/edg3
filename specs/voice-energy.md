# Voice-based energy detection — research + build plan

_Researched + scoped with Derrick 2026-06-14. MVP energy detection is **transcript-first** (decided);
this is the **v2 proprietary path**: ascribe an energy level to the *voice* we hear on the morning call._

## Is it real? Yes — it's an established field ("vocal biomarkers")
Voice carries measurable acoustic signals of physiological/psychological state, including **fatigue
and energy**. Peer-reviewed work shows speech features can be modeled to predict degree of fatigue,
and a commercial industry exists (Canary Speech, Sonde, Kintsugi, Ellipsis Health). This is credible,
defensible IP — not science fiction.

## The acoustic features that matter (what we'd extract)
- **Pitch (F0)** + pitch variability — monotone/flat speech correlates with low energy/fatigue.
- **Intensity / loudness** — quieter, less dynamic = lower energy.
- **Speech rate** + **pause rate/length** — slower speech, more/longer pauses = fatigue.
- **Jitter** (cycle-to-cycle pitch instability) + **shimmer** (loudness instability) — reliable
  stress/affect markers; hard to fake.
- **HNR** (harmonics-to-noise ratio) — voice quality/breathiness.
- **MFCCs** — general spectral fingerprint feeding the model.
Plus the **linguistic** layer (what they say) — which is exactly our transcript-first MVP.

## ⚠️ Why it needs a per-user baseline (~10 calls) — Derrick's instinct, scientifically backed
2025 research is explicit that vocal fatigue responses are **heterogeneous across individuals** — the
state of the art is **individual modeling**, not a one-size population model. A flat pitch for one
person is their normal; for another it signals exhaustion. So we must learn **each user's personal
baseline** before we can reliably say "you sound low today." ~10 calls is a reasonable calibration
window to establish that baseline (normal pitch range, rate, pause patterns, day-to-day variance).

**Product implication (build this in):** be transparent that energy perception **calibrates over ~10
calls**. Show "Edge is learning your energy — call 4 of 10" until calibrated. Under-promise, over-deliver,
build trust. Until calibrated, lean on transcript inference + explicit ask; don't act on a shaky read.

## Data source
Vapi stores the **call recording** (audio) + transcript. For prosody we fetch the recording, extract
features, and discard/secure the raw audio. (Transcript-only MVP needs no audio.)

## ★ Start SIMPLE: self-report as the label, learn the tie (Derrick, 2026-06-14)
Don't lead with the clinical science. The hard part is **labeled data**, and we already collect it:
- **The label = the user's self-reported energy** (🔴🟡🟢) — set on the dashboard, or, if they forget,
  **Edge asks on the call** ("before we dive in — how's your energy today?"). Either way we get a
  ground-truth label every day. (This loop is largely BUILT: dashboard quick-set + `setEnergyLevel`
  tool + the ask-early prompt.)
- **The input = how they sounded** that day (the call audio / a compact voice representation).
- **The goal of v1:** do a really good job of **tying voice → that day's self-reported energy** for each
  user. Learn the personal mapping from the (voice, label) pairs. Defer engineered acoustic features
  (jitter/shimmer/prosody) + clinical science to a LATER optimization — only if the simple tie needs it.

**⚠️ Data is the asset and only accrues with time** — can't be backfilled. Even before the model
exists, there's value in **banking (voice, self-reported-energy) pairs from day one** so we have weeks
of data when we build it. Requires storing call audio / a voice rep = health-adjacent PII → a
**Security/privacy decision** (consent, encryption, retention, export/delete) before we start collecting.

## Build vs buy
- **DIY** — extract features with an open library (openSMILE / Praat-style / a Python service) → a
  small model + per-user baseline. Most control + proprietary; needs an audio-processing service
  (outside Next.js) + tuning + labeled data (the user's own explicit energy answers become labels —
  the calibration calls double as training signal).
- **Buy** — a vocal-biomarker API (e.g. Canary Speech). Faster to a signal, but recurring cost,
  partnership, and **sends user audio to a third party** (privacy + Google/CASA implications).
- **Recommendation:** DIY for proprietariness, but only as **v2** after transcript-first MVP proves
  the energy loop is valuable. Use the ~10 calibration calls (with explicit energy answers as labels)
  to bootstrap the personal model.

## Phased plan (revised 2026-06-14 — simple-first)
0. **Labeling loop (mostly BUILT):** ensure every day has a self-reported energy label — dashboard
   quick-set, and Edge asks on the call if it's not set. This is the ground truth for everything below.
1. **Bank the data (decide soon):** start storing each call's voice (or a compact voice rep) tied to
   that day's self-reported label, so the per-user dataset accrues. Gated on the Security/privacy
   decision above. (Optional interim: transcript inference — LLM classifies the transcript → energy
   when the user didn't state it — as a cheap parallel signal; no audio needed.)
2. **v1 — learn the simple tie:** for each user, learn voice → that day's self-reported energy from the
   banked pairs. Keep it simple (embeddings / a light model); "calibrating N/10" until enough labeled
   days. Do this *well* before adding science.
3. **v2 — add the science only if needed:** engineered acoustic features (jitter/shimmer/prosody/HNR/
   pause-rate) + per-user baseline to improve accuracy beyond the simple tie.

## Privacy / Security (Security lane)
Call audio + derived vocal features are **health-adjacent PII** — encrypt at rest, never share with
third parties without consent, include in export/delete, and disclose in the privacy policy (esp. if
any third-party API is used). Audio retention minimized (extract features, then drop raw audio).

## Lane split
- 🛠️ **Core** — transcript classifier (MVP) in the post-call pipeline; later the acoustic feature
  consumer + baseline/calibration logic + energy precedence integration.
- 🔒 **Security** — recording fetch + audio/feature storage + encryption + retention + privacy policy;
  any third-party-API data-handling review.
- 🎨 **Design** — the "calibrating N/10 → calibrated" state + confidence display wherever energy shows.

# Ambient audio for the gratitude call (R20)

Drop a calm lo-fi / nature ambient loop here named **`gratitude-ambient-1.mp3`**
(~2 MB max). It is served statically at `<NEXT_PUBLIC_APP_URL>/audio/gratitude-ambient-1.mp3`
and passed as Vapi's `backgroundSound` **only on the gratitude call** (never the morning briefing).

If the file is absent or no app-URL env var is set, the gratitude call falls back to Vapi's
calmest built-in preset (`office`). The morning briefing always uses `off`.

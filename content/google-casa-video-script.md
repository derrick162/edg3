# Edge — Google CASA Demo Video Script
_Narration script for the OAuth verification demo video. < 5 minutes. Record screen + voice._
_Based on shot-list in `specs/google-verification.md §6`. Last updated: June 18, 2026._

---

## Before you record

**Setup:**
- Use a real Edge account (your own or a fresh test account)
- Have a Google Calendar with at least 3–4 real events visible
- Have Gmail with a sent draft from Edge (or create one fresh during the recording)
- Have a test user in Gmail contacts you can reference as "Sarah" in the script
- Screen record at 1080p minimum; mic-narrated (no music)
- Keep it calm and honest — this is for Google's assessors, not a marketing video

**Duration target:** 4–5 minutes. Don't rush. Assessors need to see what happens, not be impressed.

---

## The script

### [Opening — 0:00 to 0:30]

> "Hi, I'm Derrick Fung, founder of Edge. This video demonstrates how Edge uses Google Calendar
> and Gmail access to serve users. I'll walk through each scope we request, show exactly what
> Edge does with the data, and show how users can disconnect and delete their data."

_[Show the Edge dashboard, logged in. The Google Calendar connection is visible in the sidebar.]_

> "Edge is a voice AI chief of staff. Every morning, it calls users, reads their calendar,
> and helps them focus their day. All of the features I'll show require the user's explicit
> Google OAuth consent — nothing happens until they connect."

---

### Scene 1 — calendar.readonly: Morning briefing reads the calendar [0:30 to 1:15]

_[Navigate to the Edge dashboard. Show the 'Next call' card with a scheduled call time.]_

> "Scene one: calendar read-only access. Edge's core feature is a daily briefing that reads
> your calendar aloud."

_[Trigger a test call or show a recent briefing transcript. If using a transcript, show it on screen.]_

> "Here's what Edge said on my call this morning. It read the events from my Google Calendar —
> event titles, times, and any attendees — to build this briefing."

_[Highlight the calendar events in the transcript/summary.]_

> "The calendar data is processed in memory during the briefing generation and is not stored
> persistently. Edge logs the action in the Activity tab — that it ran the briefing — but not the
> full calendar content."

_[Show the Activity tab briefly, showing the log entry.]_

---

### Scene 2 — calendar.events: Creating a calendar event by voice [1:15 to 2:00]

_[Show a live Vapi call or play a short clip of a call. If recording live: open the Edge dashboard
and trigger a test call. During the call, say the trigger phrase.]_

> "Scene two: calendar write access. Users control their calendar by voice during the morning call."

_[During the call, say:]_ "Add a meeting with Sarah tomorrow at 3 PM called Project review."

_[After the call, open Google Calendar and show the newly created event.]_

> "Edge created the event directly in Google Calendar. The user confirmed this action during the
> call — Edge doesn't create events without the user's verbal agreement."

_[Show the Activity tab entry for the create action.]_

> "Every calendar change is logged in the Activity tab with a plain-English label and can be
> undone by the user."

---

### Scene 3 — calendar.events: Moving an event by voice [2:00 to 2:30]

_[Either continue the call or reference the Activity tab to show a move action.]_

> "Scene three: moving an event. Same scope, same pattern."

_[Say during call:]_ "Move my 3 PM meeting to 4 PM."

_[Show Google Calendar updating. Show the Activity log entry.]_

> "The event is moved in Google Calendar. The Activity tab shows 'Moved Project review from
> 3:00 PM to 4:00 PM.' The user can undo this action from the Activity tab."

---

### Scene 4 — gmail.compose: Creating an email draft [2:30 to 3:15]

_[During or after a call, trigger a draft creation. Or show an existing draft in Gmail.]_

> "Scene four: Gmail compose access. Users can ask Edge to draft outreach emails."

_[Say during call:]_ "Draft an email to Sarah about the project review we just added."

_[Open Gmail → Drafts. Show the draft Edge created.]_

> "Edge created a draft in Gmail. The user can now review it, edit it, and send it manually.
> Edge never calls Gmail's send API — only the drafts create endpoint. The draft sits in Gmail
> Drafts for the user to act on."

_[Show the draft in Gmail Drafts, not in Sent.]_

> "The draft recipient and subject are stored in Edge's database — encrypted — so the user can
> undo the draft creation if they want. No email body content is stored."

---

### Scene 5 — gmail.readonly: Reply tracking and focus prioritization [3:15 to 4:00]

_[Show the Activity tab with an "email signal" entry, or trigger a reply check during a call.]_

> "Scene five: Gmail read-only access. Edge uses this for two things. First, reply tracking.
> After a user drafts an outreach email, they can ask Edge if the recipient replied."

_[Say during call:]_ "Did Sarah reply to my project review email?"

> "Edge reads only the specific Gmail thread it originated to answer this question."

_[Show the inbox scan entry in the Activity tab.]_

> "Second, focus prioritization. Edge scans recent inbox thread metadata — specifically From,
> Subject, and Date headers — to identify threads that may deserve attention, like financial or
> legal notices. This is what powers the 'Edge read your inbox' signal in the focus recommendation."

_[Show the Activity tab entry: "Read 12 inbox threads for prioritization."]_

> "Critically: Edge uses Gmail's format-colon-metadata API parameter, which returns only headers
> and Gmail's auto-generated snippet — no message bodies are ever fetched or transmitted to our
> servers. The signal is used in memory for the AI analysis and immediately discarded. No email
> content is stored."

_[Show the edge dashboard's "What Edge knows" tab — no email content visible there.]_

---

### Scene 6 — User control: Disconnecting Google and deleting account [4:00 to 4:45]

_[Navigate to the Edge dashboard → Calendar / connections section.]_

> "Scene six: user control. Users can disconnect Google at any time."

_[Show the disconnect button. Don't actually disconnect during the recording — narrate instead.]_

> "Clicking Disconnect removes the OAuth tokens from our database and calls Google's token
> revocation API — so the authorization is removed at Google's end, not just in our system."

_[Navigate to Settings or Account section.]_

> "Users can also delete their entire account. The deletion removes all data — calendar tokens,
> Gmail draft history, call transcripts, facts, and all other records — permanently and immediately."

_[Show the delete-account confirmation UI.]_

> "Users can also revoke access directly from their Google Account at myaccount.google.com/permissions."

---

### [Closing — 4:45 to end]

> "That covers all four scopes Edge requests: calendar.readonly for reading events in the daily
> briefing, calendar.events for creating and modifying events by voice, gmail.compose for creating
> email drafts, and gmail.readonly for reply tracking and focus prioritization."

> "Edge does not store calendar event content, email body content, or any other Google user data
> beyond what's described. All OAuth tokens and sensitive metadata are encrypted at rest with
> AES-256-GCM. Users can disconnect any time and delete all their data permanently."

> "Thank you."

---

## Post-recording checklist

- [ ] Video is < 5 minutes
- [ ] All 4 scopes are demonstrated
- [ ] The "no message bodies" point is clearly stated out loud (Scene 5)
- [ ] Disconnect and delete flows are shown (Scene 6)
- [ ] Draft is shown in Gmail Drafts, NOT in Sent (Scene 4)
- [ ] Activity tab is shown at least twice (showing Edge's audit trail)
- [ ] No API keys, passwords, or sensitive data visible on screen

---

_Upload to Google Cloud Console → OAuth consent screen → Demo video URL. Reference
`specs/google-verification.md` for the full submission checklist._

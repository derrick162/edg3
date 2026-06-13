// Vapi integration for outbound voice calls

export interface VapiCallRequest {
  phoneNumber: string;
  assistantId?: string;
  assistantOverrides?: {
    firstMessage?: string;
    systemPrompt?: string;
  };
}

export interface VapiCallResponse {
  id: string;
  status: string;
  phoneNumber: string;
}

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

// Public URL Vapi calls back when a call starts/ends. Must be a real https domain —
// a localhost value (e.g. in local dev) is unreachable by Vapi, so fall back to prod.
function resolveWebhookUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const base = appUrl.startsWith('https://') ? appUrl : 'https://www.edg3.ai';
  return `${base.replace(/\/$/, '')}/api/vapi/webhook`;
}

// Verify a request to our Vapi server endpoints (tool-call / webhook) carries the shared secret
// Vapi sends as the X-Vapi-Secret header. Two-stage rollout to never lock out a live call:
//  - VAPI_SERVER_SECRET unset            -> accept everything (not configured yet)
//  - set, header matches                 -> accept
//  - set, header missing/wrong, ENFORCE off -> ACCEPT but log (Stage A, fail-open)
//  - set, header missing/wrong, ENFORCE on  -> REJECT (Stage B)
export function checkVapiSecret(provided: string | null): { ok: boolean; status: 'accepted' | 'mismatch-allowed' | 'rejected' } {
  const expected = process.env.VAPI_SERVER_SECRET;
  if (!expected) return { ok: true, status: 'accepted' };
  if (provided && provided === expected) return { ok: true, status: 'accepted' };
  return process.env.VAPI_SECRET_ENFORCE === 'true'
    ? { ok: false, status: 'rejected' }
    : { ok: true, status: 'mismatch-allowed' };
}

export async function initiateCall(
  phoneNumber: string,
  briefingContent: string,
  userName: string,
  isFirstCall: boolean = false,
  userTimezone: string = 'America/Vancouver',
  isOpenCall: boolean = false,
  prioritiesText: string = '',
  preferencesText: string = '',
): Promise<VapiCallResponse> {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
  if (!VAPI_PHONE_NUMBER_ID) throw new Error('VAPI_PHONE_NUMBER_ID not configured');

  // Calculate all date references in the user's actual timezone
  const firstName = (userName || '').split(' ')[0] || userName;
  const userTzNow = new Date(new Date().toLocaleString('en-US', { timeZone: userTimezone }));
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const userHour = userTzNow.getHours();
  const userDay = userTzNow.getDay(); // 0=Sun, 1=Mon...

  const todayD = new Date(userTzNow); todayD.setHours(0,0,0,0);
  const todayStr = toDateStr(todayD);
  const tomorrowStr = toDateStr(new Date(todayD.getTime() + 86400000));
  const in2DaysStr = toDateStr(new Date(todayD.getTime() + 2*86400000));
  const in3DaysStr = toDateStr(new Date(todayD.getTime() + 3*86400000));

  // This week Mon-Sun
  const thisMon = new Date(todayD); thisMon.setDate(todayD.getDate() - ((userDay + 6) % 7));
  const thisSun = new Date(thisMon.getTime() + 6*86400000);
  const thisFri = new Date(thisMon.getTime() + 4*86400000);
  const thisSat = new Date(thisMon.getTime() + 5*86400000);

  // Next week Mon-Sun
  const nextMon = new Date(thisMon.getTime() + 7*86400000);
  const nextSun = new Date(nextMon.getTime() + 6*86400000);
  const nextFri = new Date(nextMon.getTime() + 4*86400000);
  const nextSat = new Date(nextMon.getTime() + 5*86400000);

  // Named days of this week — compact single-line format for lower token cost
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const thisWeekDays = Array.from({length: 7}, (_, i) => `${dayNames[(userDay + i) % 7]}: ${toDateStr(new Date(todayD.getTime() + i*86400000))}`).join(' · ');

  const systemPrompt = `You are Edg3 (pronounced "Edge") — the Elite Daily Guidance Engine — AI Chief of Staff for ${userName}. If asked who you are, say "I'm Edg3, your Elite Daily Guidance Engine." Always call the user ${firstName} — never any other name, never their full name.
${isOpenCall ? `This is an open conversation ${firstName} requested — no daily briefing. Find out what's on their mind and help with whatever comes up: calendar, priorities, or just talking it through. Keep replies short and natural.` : `You already delivered the briefing. Do not repeat it. Wait for ${firstName} to respond.`}
${prioritiesText ? `\n${firstName}'S TOP PRIORITIES (you already know these — never ask them to repeat; "same as current priorities" means use exactly these):\n${prioritiesText}\n` : ''}
DATE & TIME — user's timezone: ${userTimezone}, now: ${pad(userHour)}:${pad(userTzNow.getMinutes())}
Use these exact YYYY-MM-DD dates in every tool call. Never calculate dates yourself. Map relative words ("tomorrow", "this weekend") to the matching date below — never shift based on surrounding context.

- Today (${dayNames[userDay]}): ${todayStr}
- Tomorrow (${dayNames[(userDay+1)%7]}): ${tomorrowStr}
- In 2 days (${dayNames[(userDay+2)%7]}): ${in2DaysStr}
- In 3 days (${dayNames[(userDay+3)%7]}): ${in3DaysStr}
- This Fri: ${toDateStr(thisFri)} · Sat: ${toDateStr(thisSat)} · Sun: ${toDateStr(thisSun)}
- This week (Mon–Sun): ${toDateStr(thisMon)} to ${toDateStr(thisSun)}
- Next Mon: ${toDateStr(nextMon)} · Fri: ${toDateStr(nextFri)} · Sat: ${toDateStr(nextSat)}
- Next week (Mon–Sun): ${toDateStr(nextMon)} to ${toDateStr(nextSun)}
Days of this week: ${thisWeekDays}
"Next week" = THAT Mon–Sun above, never the current week.

TIME: Current hour is ${userHour}. "This afternoon" after 17:00 → ask if they mean tomorrow.

You genuinely care about ${firstName}. Warm, direct, trusted advisor — here to help them win the day, not to judge. Keep replies one or two sentences: acknowledge, validate where genuine, redirect toward action. NEVER say "I'm listening." If they want to share something before the next call, let them know you'll pick it up on tomorrow's briefing — never tell them to text or message you directly.

SCOPE: You manage the calendar, can research into event notes (researchToEvent), and draft outreach emails as Gmail drafts (draftEmail — drafts only, never sends). You cannot send emails/texts, do open-ended research outside a calendar event, or browse arbitrarily.

MEMORY: You have full memory of all previous calls. Never say you "don't have memory" or "start fresh." Say "I have everything from our previous calls." When goals or quarterly planning come up, LEAD with what you already know — anchor to ${firstName}'s existing priorities and call notes first ("your top priorities right now are X, Y, Z — want to build the quarterly view off those?"). Only ask a question to refine or extend; never ask ${firstName} to define basics you already have. Asking "what should your goals be?" is a failure — you know them.
${preferencesText ? `\nKNOWN PREFERENCES (apply automatically to all research and recommendations — never ask ${firstName} to repeat these):\n${preferencesText}\n` : ''}
PREFERENCES: When ${firstName} states a preference or constraint in ANY domain ("smaller gyms", "boutique only", "no early meetings", "vegetarian", "quieter spots") — (a) acknowledge it briefly, (b) IMMEDIATELY apply it to the current task — re-run researchToEvent with a refined query, adjust the recommendation, etc., (c) say "I'll remember that" so they know it's saved. Auto-apply any KNOWN PREFERENCES above to every research call and recommendation without being asked — if the list says "prefers boutique gyms", don't suggest big chains. Preferences are stated once and persist across all calls.

CALENDAR TOOLS — call tools silently, then speak the result:
BE DECISIVE: For non-destructive actions (editEvent, researchToEvent, colorEvent, moveEvent, createEvent, addNotes) — act on a clear request, then report what you did. Never re-confirm "should I edit that event?" when the user already told you which one. No "I can do that" preamble before circling back to ask a question. No repeating yourself. If the target is genuinely ambiguous (multiple real matches), ask ONE short disambiguation question — then act on the answer. Only deleteEvent and cleanupEvents require the hard confirm-token gate. Everything else: act first, confirm after. Never deflect, never claim you can't do something within your tools, never ask the user to supply what you already know. Bias hard toward action.
- For edits/deletes/colors: call readCalendar first (silently), then the action tool using the exact title found. Never say "let me check" or "one moment" — just act and report: "Done — moved Vibe Coding to 2pm" or "I don't see that event on Friday."
- SPEAKING ABOUT EVENTS (voice — airtime is precious): Only mention an event's time when it adds value. YES — say the time when disambiguating ("your two PM vs your four PM meeting") or when the time itself is the point ("moved to four PM"). NO — skip the time when listing or summarizing events; just name them. When there are many events, group or count them ("three meetings back-to-back Tuesday afternoon") rather than reading each one with its time.
- ALL-DAY & MULTI-DAY: Use allDay:true. For a date range, pass the FIRST day as startDateTime and the LAST day (inclusive) as endDate — ONE spanning event, never one per day. Example: "Conrad Las Vegas June 25–28" → allDay:true, startDateTime:"2026-06-25", endDate:"2026-06-28". NEVER omit endDate for multi-day events; NEVER create one event per day. To re-date an all-day event, call moveEvent with newStartDate/newEndDate (date-only strings). Delete normally with deleteEvent.
- CONSOLIDATING / MERGING EVENTS — when the user asks to combine multiple events into one, follow this exact sequence:
  1. Confirm which events to merge and what to call the combined one. Silently call readCalendar to get each original's EXACT start time (startDateTime for timed events, startDate for all-day) — you MUST note these before creating the new event, or cleanup will fail.
  2. Call createEvent ONCE for the new merged event. Set its description to "Consolidated N events: <comma-list of originals>" so the context is preserved. Add location if relevant.
  3. Call cleanupEvents with the list of originals — for each: title + the exact startDateTime (timed) or startDate (all-day) you noted in step 1. This resolves by EXACT time (not fuzzy title), so the new merged event is NEVER confused with an original. The whole batch is deleted with a SINGLE confirmation.
  4. If cleanupEvents cannot find or remove an original (read-only calendar, not found, or not confirmed), say honestly: "I've created the combined event; I couldn't remove <X> automatically — you may want to delete it in your calendar." Then move on.
  5. Read back what you did: the new event name + which originals were removed (and any that weren't).
  The description param is optional on ALL createEvent calls; include it whenever notes or context are useful.
- LOCATION: When booking a hotel, venue, appointment, or any event with a known physical address, set location to the real street address — e.g. "3000 S Las Vegas Blvd, Las Vegas, NV 89109" for Conrad Las Vegas. If you don't know the address, omit the param rather than guessing. NEVER claim you set a location (or any other field) unless the tool confirmed it.
- FREE TIME: "When am I free?" or need to suggest a slot → call findTime() first; never guess availability.
- DISAMBIGUATION: If moveEvent/deleteEvent reports multiple matches, ask the user which one. For timed events: call again with currentTime set to that event's start (e.g. "7pm"). For all-day events (the result will say "all-day"): call again with targetEndDate set to the last inclusive day of the right event (e.g. "2026-06-25" for a single-day event, "2026-06-28" for a June 25–28 trip).
- ANTI-LOOP: NEVER repeat the same failed tool call more than once. If you ask a disambiguation question and the retry still fails or returns ambiguous, STOP immediately and say: "I'm having trouble sorting that out from here — easiest is to do it directly in your calendar, and I'll leave it alone." Then move on. Never loop on the same unresolvable action. This applies to all tools, not just deletes — looping wastes the user's time and erodes trust.
- CONFIRM BEFORE DELETING: deleteEvent returns a "Just confirming…" message with a confirmToken — read the question back word-for-word, wait for an explicit yes, then call deleteEvent again with the exact confirmToken the server gave you. Never invent or modify the token. cleanupEvents follows the same one-time-token flow for its single confirmation.
- UNDO: "undo that" / "never mind" / "put it back" → call undoLastAction(). Tell them plainly what was reversed.
- TIMEZONE MEMORY: Only call setMyTimezone() when the user is CURRENTLY in a different timezone — present tense ("I'm in Vegas now", "I'm in Toronto this week"). For FUTURE/planned travel ("I'll be in Vegas end of the month", "next week I'm in LA"), DO NOT call it — acknowledge conversationally but keep their current timezone unchanged. The override persists and will mis-time everything until manually reset. If it's ambiguous whether they're there now or just planning, ask: "Are you there now, or is that coming up?"
- HONEST FAILURE: After every tool call, report exactly what the result says. If it fails or returns "no event found" → say so: "I tried but couldn't find that — you may need to do it manually in your calendar." If there's a conflict warning → tell the user and ask what they want to do. Never say "done" unless the tool returned a clear success. Never fabricate a result or capability — including never claiming a field like location or description was set unless the tool actually confirmed it. If you're unsure whether it worked, say "Worth double-checking your calendar." A clear "I couldn't do that" is always better than a false "done."
- getEventDetails() — reads notes, location, and attendees (not just the time).
- editEvent() — updates notes/description or location.
- researchToEvent() — web research saved into event notes. Has live web search (up to 5 searches per call) — it can find gyms, restaurants, venues, contacts, local businesses, anything publicly findable. REFINEMENT IS NORMAL: when the user says "smaller ones", "independent/boutique", "cheaper", "closer", "different area", or "more options" — just call researchToEvent AGAIN with a refined query (e.g. "independent boutique gyms near downtown Vancouver"). The prior research block auto-replaces, so re-running is clean. NEVER claim you can't research something that web search can find. NEVER deflect with advice like "ask the staff at the larger ones." If a refined search genuinely returns nothing solid, say so honestly: "I searched but didn't find good options for that" — that's the only acceptable failure, and only after actually trying. Only state contact details actually in the notes; if a phone/email is "not found", say so honestly — never claim contact info you don't have.
- draftEmail() — Gmail drafts, never sends. Most reliable: pass the event title and date where researchToEvent saved contacts, plus the ask — the system extracts names/emails from those notes automatically, no need to assemble a recipients list. Set proposeAvailability:true to include real open slots. Creates one draft per contact. Tell the user how many drafts and that they're in Gmail to review. If the result says Google needs re-approving → tell them to reconnect in the dashboard. Relay any skipped contacts honestly.
- rememberPreference(statement) — call this the moment ${firstName} states a preference ("I prefer boutique gyms", "no meetings before 9", "vegetarian only"). Saves it immediately so it persists across all future calls. Always call it when a new preference is expressed — don't rely solely on post-call extraction.
- checkReplies() — call this when the user asks "did anyone reply?" or "did I hear back?" about outreach emails. Report the result honestly: if no replies, say so; if Google read permission is missing, tell them to reconnect in the dashboard. Replies are also surfaced automatically in briefings.
- You cannot: send emails/texts, research outside a calendar event, or browse arbitrarily.

NEVER INVENT FACTS: Only state events, flights, or travel plans confirmed by calling readCalendar this call. Never infer from memory or context. Unsure? Call readCalendar or ask — never guess.

GROUNDED OBSERVATIONS: Only call the day "important", "big", or "significant" when you have a CONCRETE reason from the calendar or priorities — and say that reason in the same breath ("big day — the investor call is at two"). Generic "today is an important day" with no backing is noise, not insight. If nothing on the calendar is particularly notable, skip the significance framing entirely and move forward.

NO INVENTED NUMBERS: Never compute or quote aggregate capacity or hour totals ("X hours to allocate", "Y hours free next week"). You were never given such a figure. The ONLY hours you may cite are the ones explicitly in ALIGNMENT DATA in the briefing. For availability, reference SPECIFIC free slots from findTime ("Tuesday two to four is open") — never a fabricated sum. A week has 168 hours; any larger number is a calculation error.

TIMEZONES IN TOOL CALLS: When the user states a timezone ("seven PM Eastern"), pass that EXACT zone to the tool: Eastern → America/Toronto · Pacific → America/Vancouver · Central → America/Chicago · Mountain → America/Denver. Never substitute their home timezone.

BOOKING CONFLICTS: If createEvent warns about a conflict and the user says to book it anyway, call again with overrideConflicts:true.

PRIORITY BLOCKING: If the briefing surfaced a priority gap and offered to block a specific time slot (e.g. "Want me to block Tuesday at two PM for fundraising?"), and the user says yes / go ahead / book it — immediately call createEvent with that exact slot and a title like "Focus: [priority]". Don't re-ask for confirmation. Just book it and say "Done — blocked [day] at [time] for [priority]."

After asking a question — especially the closing question — stop and wait a full 15 seconds. Never rush. Never end mid-conversation; finish the thought, then close warmly.
${isOpenCall ? 'Open call: keep replies short, let it flow. Wrap up only when the user signals they are done.' : isFirstCall ? 'First call: ~2 minutes. Close with "I want to keep today\'s first call short and sweet — we\'ll go deeper tomorrow. Have a focused day."' : 'After the briefing, open it up — let it flow naturally. Wrap up only when the user is done.'}
BEFORE ENDING: When winding down, say "I should let you go — want me to run through my action items real quick?" Wait for response. Yes → summarize. No/dismissive → "Perfect. Have a focused day." After 15 seconds of silence post-close, say "I\'ll take that as a sign you\'re ready to move. Have a focused day."
Always end with warmth. This person is building something — remind them of that.`;

  const payload: Record<string, unknown> = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: {
      number: phoneNumber,
    },
    assistant: VAPI_ASSISTANT_ID ? undefined : {
      name: 'EDG3',
      server: {
        url: resolveWebhookUrl(),
        ...(process.env.VAPI_SERVER_SECRET ? { secret: process.env.VAPI_SERVER_SECRET } : {}),
      },
      voice: {
        provider: '11labs',
        voiceId: '3WqHLnw80rOZqJzW9YRB', // Daniel
        model: 'eleven_turbo_v2_5',
        stability: 0.3,
        similarityBoost: 0.75,
      },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        systemPrompt,
        toolIds: [
          'cb7f9a73-49eb-47a8-8124-b9d593a6ad2c',
          '4ac1508f-e8b1-46d4-aacf-2e7122f4594e',
          '734cc748-4604-4637-80df-f760b1ca5707',
          'c45c579a-3b6a-4587-a134-7e271d3bc601',
          '22d56b6f-5e86-4eaf-bebf-4067d9db6005',
          '057c20b1-32ec-4956-b1cc-908b60238a90',
          '782462ad-1c4d-4c82-ac3c-02576aeb2622',
          '44037a74-6488-4239-b354-a7075b673b6a', // copyDayEvents
          '0eef82fe-1e92-4ea9-92bc-b12340152acc', // findTime
          '45fbcfe4-ac83-49ad-80a4-13c251cd4e68', // setMyTimezone
          'a27bc95c-6f4e-4c16-808d-865ee80387d2', // getEventDetails
          '07bcbdab-c4fb-4219-a468-4b7afd48fcfa', // editEvent
          '69615e5d-90e2-4f5f-8293-ad9c00e5794c', // researchToEvent
          '2c1c3ad9-da5f-4c61-b6ba-b2233be72e29', // undoLastAction
          'e62078db-fbf4-4f58-b17f-5a620d751d17', // draftEmail (verified Anthropic-valid 2026-06-09)
          // checkReplies: CREATE in Vapi dashboard (no required params), then paste the UUID here.
          // 'REPLACE_WITH_CHECKREPLIES_TOOL_ID',  // checkReplies — uncomment after creating in Vapi
          // cleanupEvents: CREATE in Vapi dashboard (params: events array + confirmToken string), then paste UUID here.
          // 'REPLACE_WITH_CLEANUPEVENTS_TOOL_ID', // cleanupEvents — uncomment after creating in Vapi
          // rememberPreference: CREATE in Vapi dashboard (params: statement string), then paste UUID here.
          // 'REPLACE_WITH_REMEMBERPREFERENCE_TOOL_ID', // rememberPreference — uncomment after creating in Vapi
        ],
      },
      firstMessage: briefingContent,
      endCallMessage: "Understood. I'll factor that into tomorrow's briefing. Have a focused day.",
      // Noise/interruption tuning: require ~2 transcribed words (not raw voice-activity
      // detection) before Edge stops talking, and denoise the caller's audio — so a cough,
      // a door, or background chatter no longer cuts him off mid-sentence.
      backgroundDenoisingEnabled: true,
      backgroundSound: 'off',
      stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.3, backoffSeconds: 1 },
      // Smart endpointing: start replying as soon as it detects the user is actually done,
      // rather than always waiting a fixed gap — Edge feels noticeably snappier.
      startSpeakingPlan: { waitSeconds: 0.4, smartEndpointingPlan: { provider: 'livekit' } },
      // Idle hold behaviour: reassure on silence instead of going dead and hanging up.
      // ~10s → first check-in · ~20s → second · ~30s → check-in asking if user wants to hold.
      // Then 40s total silence ends the call gracefully.
      // ⚠️ Verify idleMessages / idleTimeoutSeconds / idleMessageMaxSpokenCount field names
      //    against the live Vapi API before relying on this — idle behaviour needs a real call to validate.
      messagePlan: {
        idleMessages: [
          'Still here — take your time.',
          "No rush, I'm still on the line.",
          "Still want me to hold, or should I let you go? You can always call me back.",
        ],
        idleTimeoutSeconds: 10,
        idleMessageMaxSpokenCount: 3,
      },
      silenceTimeoutSeconds: 40,
      maxDurationSeconds: 1800,
      endCallPhrases: ['have a focused day', 'have a great day', 'goodbye'],
    },
    assistantId: VAPI_ASSISTANT_ID || undefined,
    assistantOverrides: VAPI_ASSISTANT_ID ? {
      firstMessage: briefingContent,
      model: { systemPrompt },
      messagePlan: {
        idleMessages: [
          'Still here — take your time.',
          "No rush, I'm still on the line.",
          "Still want me to hold, or should I let you go? You can always call me back.",
        ],
        idleTimeoutSeconds: 10,
        idleMessageMaxSpokenCount: 3,
      },
      silenceTimeoutSeconds: 40,
    } : undefined,
  };

  // Remove undefined keys
  const cleanPayload = JSON.parse(JSON.stringify(payload));

  const response = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cleanPayload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[vapi] Call failed. Status: ${response.status}. Body: ${error}`);
    throw new Error(`Vapi call failed: ${error}`);
  }

  return response.json();
}

export async function getCallDetails(callId: string) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');

  const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
    },
  });

  if (!response.ok) throw new Error('Failed to fetch call details');
  return response.json();
}

export function extractUserResponseFromTranscript(transcript: string): string | null {
  const lines = transcript.split('\n');
  const userLines = lines
    .filter(l => l.startsWith('User:') || l.startsWith('Customer:'))
    .map(l => l.replace(/^(User:|Customer:)\s*/, '').trim())
    .filter(l => l.length > 5 && !['thank you', 'thanks', 'okay', 'ok', 'bye', 'goodbye'].includes(l.toLowerCase()));

  if (!userLines.length) return null;
  // Return the longest/most substantive user response
  return userLines.sort((a, b) => b.length - a.length)[0];
}

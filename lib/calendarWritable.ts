// accessRole values Google Calendar returns: 'owner', 'writer', 'reader', 'freeBusyReader'.
// A calendar is writable only when the user owns it or has explicit write access.
export function isWritable(accessRole: string): boolean {
  return accessRole === 'owner' || accessRole === 'writer';
}

// Whether the user can reschedule/move an event on a writable calendar.
// Google 403s time changes from non-organizers unless guestsCanModify is true.
// When organizer info is absent (self-created events, older API responses), give
// benefit of the doubt and let the patch attempt proceed.
export function canUserReschedule(event: {
  organizer?: { self?: boolean | null } | null;
  guestsCanModify?: boolean | null;
}): boolean {
  if (!event.organizer) return true;          // no organizer info → try the patch
  if (event.organizer.self === true) return true;    // user IS the organizer
  if (event.guestsCanModify === true) return true;   // organizer allowed edits
  return false; // someone else's meeting → Google will 403 a time change
}

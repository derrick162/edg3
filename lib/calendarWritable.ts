// accessRole values Google Calendar returns: 'owner', 'writer', 'reader', 'freeBusyReader'.
// A calendar is writable only when the user owns it or has explicit write access.
export function isWritable(accessRole: string): boolean {
  return accessRole === 'owner' || accessRole === 'writer';
}

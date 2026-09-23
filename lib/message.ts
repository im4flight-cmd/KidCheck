/**
 * The outgoing page message text. Kept separate from paging.ts (which needs
 * CCB and Clearstream) so it has no dependencies at all and is trivially
 * testable directly by the test suite.
 */

function messageTemplate(): string {
  return String(process.env.PAGE_MESSAGE || 'Please come to {room} for your child at Country Faith Church.');
}

// The room name can be blank at the source (an ad hoc/test check-in event
// CCB never assigned a Room Name to -- confirmed live 2026-09-23, a real
// text went out naming no room at all) even after every upstream fallback,
// so this is the last line of defense: never substitute an empty string.
export function buildMessage(room: string): string {
  const r = String(room || '').trim() || 'the classroom';
  return messageTemplate().replace(/\{room\}/g, r);
}

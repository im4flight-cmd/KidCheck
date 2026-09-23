import Link from 'next/link';
import { getRooms } from '@/lib/rooms';
import { currentChurchWeekday, roomMeetsOnWeekday, discoverChildrensMinistryRooms } from '@/lib/ccb';

export const dynamic = 'force-dynamic';

function Arrow() {
  return (
    <svg className="rc-arrow" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const showAll = all === '1';
  const allRooms = getRooms();
  const weekday = currentChurchWeekday();
  // Only show rooms that actually meet today (Sundays show the age group
  // rooms, Fridays show Bible Study Kids, etc), based on each room's own
  // event_profile schedule. Falls open to showing a room when that can't be
  // determined (CCB not configured yet, demo mode, a permission hiccup), so
  // this can only ever hide a room CCB positively confirms doesn't meet
  // today, never one it simply couldn't check. "Show all classrooms" always
  // bypasses this, so a wrong guess never fully strands anyone.
  const eligible = showAll
    ? allRooms.map(() => true)
    : await Promise.all(allRooms.map((room) => roomMeetsOnWeekday(room.id.split(','), weekday)));
  const configuredRooms = allRooms.filter((_, i) => eligible[i]);
  const someHidden = !showAll && configuredRooms.length < allRooms.length;

  // Any other Children's Ministry event CCB knows about, not already in
  // rooms.json, so a newly created recurring class/program shows up without
  // a manual edit here. rooms.json's own rooms always keep their friendly
  // name and order; discovered ones are appended using CCB's own event name.
  const knownIds = new Set(allRooms.flatMap((r) => r.id.split(',')));
  const discovered = await discoverChildrensMinistryRooms(showAll ? null : weekday, knownIds);
  const rooms = [...configuredRooms, ...discovered];

  return (
    <main className="picker">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/brand/cfc-wordmark-white.png" alt="Country Faith Church" />
      <h1>Classroom Check-In</h1>
      <p className="subtitle">Pick a classroom to open its live check-in display.</p>

      {rooms.length > 0 ? (
        <div className="room-grid">
          {rooms.map((room) => (
            <Link key={room.id} className="room-card" href={`/room/${encodeURIComponent(room.id)}`}>
              <span>
                <span className="rc-open">Open display</span>
                <br />
                <span className="rc-name">{room.name}</span>
              </span>
              <Arrow />
            </Link>
          ))}
        </div>
      ) : allRooms.length > 0 ? (
        <div className="setup">
          <h2>No classes meet today</h2>
          <p>None of the configured classrooms have a meeting scheduled today.</p>
        </div>
      ) : (
        <div className="setup">
          <h2>No classrooms yet</h2>
          <p>
            Add your rooms so they show up here. Each room needs a name and its
            ChMS event id (the number in the event URL inside ChMS).
          </p>
          <p>
            Either set a <code>ROOMS</code> environment variable in Vercel, for
            example <code>{'[{"id":"12345","name":"Nursery"}]'}</code>, or edit{' '}
            <code>rooms.json</code> in the project and redeploy. See{' '}
            <code>rooms.example.json</code> for the shape.
          </p>
        </div>
      )}

      {(someHidden || (rooms.length === 0 && allRooms.length > 0)) && (
        <p className="show-all">
          <Link href="/?all=1">Show all classrooms</Link>
        </p>
      )}
    </main>
  );
}

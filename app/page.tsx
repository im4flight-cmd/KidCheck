import Link from 'next/link';
import { getRooms } from '@/lib/rooms';
import {
  currentChurchWeekday,
  currentChurchDate,
  roomMeetsOnWeekday,
  discoverChildrensMinistryRooms,
  discoverExtraRooms,
} from '@/lib/ccb';

export const dynamic = 'force-dynamic';

// The 5 Sunday kids ministry classrooms, always shown on the ?all=1 page
// regardless of the day, in this order, per Wayne's request. Everything
// else configured in rooms.json (currently just Bible Study Kids) goes in
// the "Weekday & Special Events" folder instead.
const SUNDAY_ROOM_NAMES = new Set(['Nursery', '3-5 Year Olds', 'K-1st Grade', '2nd-4th Grade', '5th-6th Grade']);

function Arrow() {
  return (
    <svg className="rc-arrow" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TodayTag() {
  return <span className="today-tag">Today</span>;
}

function RoomCard({ id, name, today }: { id: string; name: string; today?: boolean }) {
  return (
    <Link className="room-card" href={`/room/${encodeURIComponent(id)}`}>
      <span>
        <span className="rc-open">Open display</span>
        <br />
        <span className="rc-name">
          {name}
          {today && <TodayTag />}
        </span>
      </span>
      <Arrow />
    </Link>
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

  // SECTION 1, "today's classrooms": unchanged from before, and identical
  // whether this is the plain picker or ?all=1 -- Wayne asked to keep this
  // exact behavior. Only shows rooms that actually meet today, based on each
  // room's own event_profile schedule. Falls open to showing a room when
  // that can't be determined (CCB not configured yet, demo mode, a
  // permission hiccup), so this can only ever hide a room CCB positively
  // confirms doesn't meet today, never one it simply couldn't check.
  const eligible = await Promise.all(allRooms.map((room) => roomMeetsOnWeekday(room.id.split(','), weekday)));
  const configuredRooms = allRooms.filter((_, i) => eligible[i]);
  const someHidden = configuredRooms.length < allRooms.length;

  const knownIds = new Set(allRooms.flatMap((r) => r.id.split(',')));
  const discoveredToday = await discoverChildrensMinistryRooms(currentChurchDate(), knownIds);
  const todaysRooms = [...configuredRooms, ...discoveredToday];

  // ?all=1 only: SECTION 2 (the 5 Sunday rooms, always, minus whichever are
  // already in section 1 today) and SECTION 3 (everything else, in a
  // collapsible folder).
  let sundayRooms: { id: string; name: string }[] = [];
  let folderRooms: { id: string; name: string; isToday: boolean }[] = [];
  let folderHasToday = false;
  if (showAll) {
    const todaysIds = new Set(todaysRooms.map((r) => r.id));
    sundayRooms = allRooms.filter((r) => SUNDAY_ROOM_NAMES.has(r.name) && !todaysIds.has(r.id));

    const otherConfigured = allRooms.filter((r) => !SUNDAY_ROOM_NAMES.has(r.name));
    const otherConfiguredWithToday = await Promise.all(
      otherConfigured.map(async (r) => ({
        id: r.id,
        name: r.name,
        isToday: await roomMeetsOnWeekday(r.id.split(','), weekday),
      })),
    );
    const extraDiscovered = await discoverExtraRooms(knownIds);
    folderRooms = [...otherConfiguredWithToday, ...extraDiscovered].sort(
      (a, b) => Number(b.isToday) - Number(a.isToday),
    );
    folderHasToday = folderRooms.some((r) => r.isToday);
  }

  return (
    <main className="picker">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/brand/cfc-wordmark-white.png" alt="Country Faith Church" />
      <h1>Classroom Check-In</h1>
      <p className="subtitle">Pick a classroom to open its live check-in display.</p>

      {todaysRooms.length > 0 ? (
        <div className="room-grid">
          {todaysRooms.map((room) => (
            <RoomCard key={room.id} id={room.id} name={room.name} />
          ))}
        </div>
      ) : allRooms.length > 0 ? (
        <div className="setup">
          <h2>No classrooms scheduled today</h2>
          <p>None of the configured or discovered classrooms have a meeting scheduled today.</p>
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

      {!showAll && (someHidden || (todaysRooms.length === 0 && allRooms.length > 0)) && (
        <p className="show-all">
          <Link href="/?all=1">Show all classrooms</Link>
        </p>
      )}

      {showAll && sundayRooms.length > 0 && (
        <section className="picker-section">
          <h2 className="section-heading">Sunday Service Classrooms</h2>
          <div className="room-grid">
            {sundayRooms.map((room) => (
              <RoomCard key={room.id} id={room.id} name={room.name} />
            ))}
          </div>
        </section>
      )}

      {showAll && folderRooms.length > 0 && (
        <details className="picker-folder" open={folderHasToday}>
          <summary>Weekday &amp; Special Events</summary>
          <div className="room-grid">
            {folderRooms.map((room) => (
              <RoomCard key={room.id} id={room.id} name={room.name} today={room.isToday} />
            ))}
          </div>
        </details>
      )}
    </main>
  );
}

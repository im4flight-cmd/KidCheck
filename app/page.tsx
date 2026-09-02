import Link from 'next/link';
import { getRooms } from '@/lib/rooms';

export const dynamic = 'force-dynamic';

function Arrow() {
  return (
    <svg className="rc-arrow" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HomePage() {
  const rooms = getRooms();

  return (
    <main className="picker">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/brand/cfc-wordmark-white.png" alt="Country Faith Church" />
      <h1>Classroom Check-In</h1>
      <p className="subtitle">Pick a classroom to open its live check-in display.</p>

      {rooms.length > 0 ? (
        <div className="room-grid">
          {rooms.map((room) => (
            <Link key={room.id} className="room-card" href={`/room/${room.id}`}>
              <span>
                <span className="rc-open">Open display</span>
                <br />
                <span className="rc-name">{room.name}</span>
              </span>
              <Arrow />
            </Link>
          ))}
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
    </main>
  );
}

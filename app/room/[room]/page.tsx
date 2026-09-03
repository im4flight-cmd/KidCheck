import Link from 'next/link';
import RoomBoard from '@/components/RoomBoard';
import { getRoom } from '@/lib/rooms';
import { pagingEnabled } from '@/lib/paging';

export const dynamic = 'force-dynamic';

// A combined room's id carries commas ("118,112,119"), which the picker link
// URL-encodes to %2C. Next hands the path param back still encoded, so decode
// it before validating and looking it up.
function decodeRoom(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ room: string }>;
  searchParams: Promise<{ occurrence?: string }>;
}) {
  const { room: rawRoom } = await params;
  const { occurrence } = await searchParams;
  const room = decodeRoom(rawRoom);

  if (!/^\d+(,\d+)*$/.test(room)) {
    return (
      <main className="picker">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/brand/cfc-wordmark-white.png" alt="Country Faith Church" />
        <div className="setup">
          <h2>That is not a valid room</h2>
          <p>Room ids are numbers. Go back and pick a classroom from the list.</p>
          <p>
            <Link href="/" className="rc-open">
              Back to classrooms
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const configured = getRoom(room);
  const occ =
    typeof occurrence === 'string' &&
    /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(occurrence)
      ? occurrence
      : '';
  return (
    <RoomBoard
      roomId={room}
      initialName={configured?.name ?? ''}
      occurrence={occ}
      paging={pagingEnabled()}
    />
  );
}

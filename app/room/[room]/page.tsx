import Link from 'next/link';
import RoomBoard from '@/components/RoomBoard';
import { getRoom } from '@/lib/rooms';

export const dynamic = 'force-dynamic';

export default async function RoomPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;

  if (!/^\d+$/.test(room)) {
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
  return <RoomBoard roomId={room} initialName={configured?.name ?? ''} />;
}

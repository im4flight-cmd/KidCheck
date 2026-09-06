import { NextRequest, NextResponse } from 'next/server';
import {
  getRoster,
  diagnoseEventDates,
  diagnoseEventOccurrences,
  diagnoseNoOccurrence,
  diagnoseGuardianRaw,
} from '@/lib/ccb';

// Always run fresh, never statically cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  // Temporary: /api/roster?debugGuardian=<child id> raw-dumps the guardian
  // lookup for one child, to see CCB's actual shape when it comes back empty.
  // Independent of `room`, since this takes a child/individual id instead.
  const debugGuardian = req.nextUrl.searchParams.get('debugGuardian');
  if (debugGuardian) {
    const info = await diagnoseGuardianRaw(debugGuardian);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }

  const room = req.nextUrl.searchParams.get('room') ?? '';
  const occurrence = req.nextUrl.searchParams.get('occurrence') ?? '';

  // One event id, or several comma-separated for a combined room.
  if (!/^\d+(,\d+)*$/.test(room)) {
    return NextResponse.json(
      { error: 'Missing or invalid room id.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Temporary setup diagnostic: /api/roster?room=<single event id>&debug=1
  // reports how many attendance records ChMS has per recent date (no names).
  if (req.nextUrl.searchParams.get('debug') === '1') {
    const info = await diagnoseEventDates(room);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }
  // Temporary: /api/roster?room=<single event id>&debug=2 asks CCB what
  // occurrences/schedule entries exist for the event (dates/times only).
  if (req.nextUrl.searchParams.get('debug') === '2') {
    const info = await diagnoseEventOccurrences(room);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }
  // Temporary: /api/roster?room=<single event id>&debug=3 asks
  // attendance_profile with NO occurrence, letting CCB pick its own default.
  if (req.nextUrl.searchParams.get('debug') === '3') {
    const info = await diagnoseNoOccurrence(room);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }

  const roster = await getRoster(room, occurrence);
  return NextResponse.json(roster, {
    headers: {
      'Cache-Control': 'no-store',
      // Lets the display detect when a newer version has been deployed.
      'X-Build-Id': process.env.NEXT_PUBLIC_BUILD_ID ?? '',
    },
  });
}

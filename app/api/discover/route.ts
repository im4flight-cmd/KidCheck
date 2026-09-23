import { NextRequest, NextResponse } from 'next/server';
import { diagnoseDiscoveryEligibility, currentChurchDate, isValidOccurrence } from '@/lib/ccb';
import { getRooms } from '@/lib/rooms';

// Always run fresh, never statically cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get('debug');

  // TEMPORARY eligibility debug view: ?debug=2[&date=YYYY-MM-DD] reports,
  // for every Children's Ministry (grouping id 6) event, its own start_date,
  // start_datetime, recurrence_description, and the exact eligibility
  // decision + reason the room picker would use for that date (today, church
  // timezone, unless a date is given) -- so a wrong inclusion OR exclusion
  // is visible directly instead of guessed at. Deliberately narrow (id,
  // name, dates, a reason string): no phone/organizer/contact fields, unlike
  // the raw event_profiles probe this route used to also expose as ?debug=1
  // (removed 2026-09-23: event_profiles entries carry an organizer phone
  // number, which that raw dump returned unredacted, unauthenticated).
  if (debug === '2') {
    const dateParam = req.nextUrl.searchParams.get('date') ?? '';
    const targetDate = isValidOccurrence(dateParam) ? dateParam.slice(0, 10) : currentChurchDate();
    const knownIds = new Set(getRooms().flatMap((r) => r.id.split(',')));
    const info = await diagnoseDiscoveryEligibility(targetDate, knownIds);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    { error: 'Add ?debug=2 (eligibility decisions) to use this temporary discovery route.' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

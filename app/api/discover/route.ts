import { NextRequest, NextResponse } from 'next/server';
import { diagnoseEventProfiles, diagnoseDiscoveryEligibility, currentChurchDate, isValidOccurrence } from '@/lib/ccb';
import { getRooms } from '@/lib/rooms';

// Always run fresh, never statically cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get('debug');

  // TEMPORARY discovery probe: ?debug=1[&modified_since=...&page=...] tries
  // the hypothesized event_profiles (plural) LIST service. Any extra query
  // param besides `debug` is forwarded straight through to CCB, so a
  // required filter/paging param CCB's own error names can be tried without
  // a redeploy. Strictly read-only. See lib/ccb.ts's diagnoseEventProfiles
  // for why this does not guess at CCB's field names.
  if (debug === '1') {
    const extra: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'debug') extra[key] = value;
    });
    const info = await diagnoseEventProfiles(extra);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }

  // TEMPORARY eligibility debug view: ?debug=2[&date=YYYY-MM-DD] reports,
  // for every Children's Ministry (grouping id 6) event, its own start_date,
  // start_datetime, recurrence_description, and the exact eligibility
  // decision + reason the room picker would use for that date (today, church
  // timezone, unless a date is given) -- so a wrong inclusion OR exclusion
  // is visible directly instead of guessed at.
  if (debug === '2') {
    const dateParam = req.nextUrl.searchParams.get('date') ?? '';
    const targetDate = isValidOccurrence(dateParam) ? dateParam.slice(0, 10) : currentChurchDate();
    const knownIds = new Set(getRooms().flatMap((r) => r.id.split(',')));
    const info = await diagnoseDiscoveryEligibility(targetDate, knownIds);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    { error: 'Add ?debug=1 (raw event_profiles probe) or ?debug=2 (eligibility decisions) to use this temporary discovery route.' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

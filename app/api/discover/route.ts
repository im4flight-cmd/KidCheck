import { NextRequest, NextResponse } from 'next/server';
import { diagnoseEventProfiles } from '@/lib/ccb';

// Always run fresh, never statically cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * TEMPORARY discovery probe: /api/discover?debug=1[&modified_since=...&page=...]
 * Tries the hypothesized event_profiles (plural) LIST service. Any extra
 * query param besides `debug` is forwarded straight through to CCB, so a
 * required filter/paging param CCB's own error names can be tried without a
 * redeploy. Strictly read-only. See lib/ccb.ts's diagnoseEventProfiles for
 * why this does not guess at CCB's field names.
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('debug') !== '1') {
    return NextResponse.json(
      { error: 'Add ?debug=1 to use this temporary discovery probe.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const extra: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'debug') extra[key] = value;
  });

  const info = await diagnoseEventProfiles(extra);
  return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
}

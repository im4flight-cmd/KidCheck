import { NextRequest, NextResponse } from 'next/server';
import { sendPage, recentSendDebugLog } from '@/lib/paging';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * TEMPORARY, read-only: /api/page?debug=1 reports the raw Clearstream
 * response from the most recent real sends (up to 10, this warm instance
 * only) plus one immediate status-lookup attempt made right after each,
 * for delivery-confirmation investigation. Sends nothing itself -- it only
 * reads what a real "Text parent" tap already did. Vercel is serverless, so
 * this can come back empty if the request lands on a different instance
 * than the one that just sent; trigger a real send, then open this
 * right away.
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('debug') !== '1') {
    return NextResponse.json(
      { error: 'Add ?debug=1 to use this temporary probe.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json({ recentSends: recentSendDebugLog() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let payload: { room?: string; childId?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const room = String(payload?.room ?? '');
  const childId = String(payload?.childId ?? '');

  const pageResult = await sendPage(childId, room);
  // Always 200; the client reads `error` vs `ok` from the body.
  return NextResponse.json(pageResult, { headers: { 'Cache-Control': 'no-store' } });
}

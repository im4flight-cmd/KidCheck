import { NextRequest, NextResponse } from 'next/server';
import { sendPage, recentSendDebugLog, listRecentClearstreamMessages } from '@/lib/paging';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get('debug');

  // TEMPORARY, read-only: ?debug=1 reports the raw Clearstream response from
  // the most recent real sends (up to 10, this warm instance only) plus one
  // immediate status-lookup attempt made right after each. Sends nothing
  // itself. Vercel is serverless, so this can come back empty if the
  // request lands on a different instance than the one that sent, or if
  // enough time has passed that the instance recycled; trigger a real send,
  // then open this right away, or use ?debug=2 instead for an older send.
  if (debug === '1') {
    return NextResponse.json({ recentSends: recentSendDebugLog() }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // TEMPORARY, read-only: ?debug=2[&page=...&per_page=...] asks Clearstream
  // itself for a list of recent messages (a plain GET on the same URL a send
  // POSTs to), so an earlier send can be checked without needing this app's
  // own in-memory log to have survived. Never sends anything.
  if (debug === '2') {
    const extra: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'debug') extra[key] = value;
    });
    const info = await listRecentClearstreamMessages(extra);
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    { error: 'Add ?debug=1 (recent real sends, this instance only) or ?debug=2 (ask Clearstream for recent messages directly) to use this temporary probe.' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
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

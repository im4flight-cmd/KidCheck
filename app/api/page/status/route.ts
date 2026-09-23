import { NextRequest, NextResponse } from 'next/server';
import { pagingEnabled, checkClearstreamMessageStatus } from '@/lib/paging';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/page/status?id=<clearstream message id>
 * Polled by the display after a real send, to show delivery confirmation.
 * Returns ONLY a sanitized {found, status, delivered, failed, optedOut,
 * reason} -- never subscriber/contact data. Clearstream's own message
 * lookup includes OTHER people's name/phone/email too (confirmed live
 * 2026-09-23, the reason an earlier raw-dump debug probe was a real privacy
 * bug and was removed entirely); checkClearstreamMessageStatus reads that
 * raw response only in server memory and must never be changed to pass any
 * of it through here.
 */
export async function GET(req: NextRequest) {
  if (!pagingEnabled()) {
    return NextResponse.json({ found: false, delivered: false, failed: false, optedOut: false }, { status: 200 });
  }
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const status = await checkClearstreamMessageStatus(id);
  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}

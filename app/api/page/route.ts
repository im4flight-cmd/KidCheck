import { NextRequest, NextResponse } from 'next/server';
import { sendPage } from '@/lib/paging';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  let payload: { room?: string; childId?: string; pin?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const room = String(payload?.room ?? '');
  const childId = String(payload?.childId ?? '');
  const pin = String(payload?.pin ?? '');

  const result = await sendPage(childId, room, pin);
  // Always 200; the client reads `error` vs `ok` from the body.
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

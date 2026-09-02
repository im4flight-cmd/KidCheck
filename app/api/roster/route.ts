import { NextRequest, NextResponse } from 'next/server';
import { getRoster } from '@/lib/ccb';

// Always run fresh, never statically cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get('room') ?? '';
  const occurrence = req.nextUrl.searchParams.get('occurrence') ?? '';

  if (!/^\d+$/.test(room)) {
    return NextResponse.json(
      { error: 'Missing or invalid room id.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const data = await getRoster(room, occurrence);
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

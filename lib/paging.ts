/**
 * Parent paging via Clearstream (the church texting service).
 *
 * A teacher taps a child on the display; the server looks up that child's
 * guardian phone from CCB and sends a one-off text through Clearstream's API.
 * Nothing here runs unless PAGING_ENABLED=true, and it stays in a safe test
 * mode (logs instead of sends) until a real CLEARSTREAM_API_KEY is set.
 *
 * Clearstream API (confirmed shape):
 *   POST https://api.getclearstream.com/v1/messages
 *   Header: X-Api-Key: <key>
 *   Form fields: message_header, message_body, to (recipient mobile number)
 * The exact success/error body should be eyeballed on the first live send;
 * we log Clearstream's response so that is a one-line adjustment if needed.
 */

import { fetchGuardian } from '@/lib/ccb';
import { toE164 } from './phone';

const CLEARSTREAM_URL = 'https://api.getclearstream.com/v1/messages';
const RESEND_BLOCK_MS = 60000;
const lastSent = new Map<string, number>();

export function pagingEnabled(): boolean {
  return process.env.PAGING_ENABLED === 'true';
}

function pagePin(): string {
  return String(process.env.PAGE_PIN ?? '').trim();
}

function senderHeader(): string {
  return String(process.env.PAGE_SENDER || 'Country Faith Church').slice(0, 30);
}

function messageTemplate(): string {
  return String(process.env.PAGE_MESSAGE || 'Please come to {room} for your child at Country Faith Church.');
}

// Live only when a key is present and test mode is not forced on.
function isLive(): boolean {
  return !!process.env.CLEARSTREAM_API_KEY && process.env.PAGING_TEST !== 'true';
}

export function buildMessage(room: string): string {
  const r = String(room || '').trim() || 'the classroom';
  return messageTemplate().replace(/\{room\}/g, r);
}

function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  return d.length >= 4 ? '••• ••• ' + d.slice(-4) : '••••';
}

export type PageResult =
  | { ok: true; dryRun: boolean; guardian: string; toMasked: string; throttled?: boolean }
  | { error: string };

export async function sendPage(childId: string, room: string, pin: string): Promise<PageResult> {
  if (!pagingEnabled()) return { error: 'Paging is turned off.' };

  const demo = process.env.DEMO_MODE === 'true';

  if (!demo) {
    const required = pagePin();
    if (!required) return { error: 'Paging is not fully set up yet (no PIN configured).' };
    if (String(pin ?? '').trim() !== required) return { error: 'That PIN is not right.' };
    if (!/^\d+$/.test(String(childId))) return { error: 'Invalid child.' };
  }

  // Find the guardian to text.
  let guardian = 'their parent';
  let phone = '';
  if (demo) {
    phone = '+12105550142';
  } else {
    const g = await fetchGuardian(childId);
    if (g?.guardian) guardian = g.guardian;
    phone = g?.phone ? toE164(g.phone) : '';
  }
  if (!phone) return { error: 'No parent phone is on file for this child in CCB.' };

  // Guard against an accidental double tap texting a parent twice.
  const now = Date.now();
  const prev = lastSent.get(childId);
  if (prev && now - prev < RESEND_BLOCK_MS) {
    return { ok: true, dryRun: !isLive(), guardian, toMasked: maskPhone(phone), throttled: true };
  }

  const body = buildMessage(room);

  if (!isLive()) {
    lastSent.set(childId, now);
    // eslint-disable-next-line no-console
    console.log(`[paging:test] would text ${maskPhone(phone)} (${guardian}) via "${senderHeader()}": ${body}`);
    return { ok: true, dryRun: true, guardian, toMasked: maskPhone(phone) };
  }

  const sent = await sendClearstream(phone, senderHeader(), body);
  if (!sent.ok) {
    // eslint-disable-next-line no-console
    console.error('[paging:clearstream] send failed', sent.status, sent.detail);
    return { error: `The text service did not accept the message (${sent.status || 'no response'}).` };
  }
  lastSent.set(childId, now);
  return { ok: true, dryRun: false, guardian, toMasked: maskPhone(phone) };
}

async function sendClearstream(
  to: string,
  header: string,
  body: string,
): Promise<{ ok: boolean; status: number; detail?: string }> {
  const key = String(process.env.CLEARSTREAM_API_KEY ?? '');
  const form = new URLSearchParams();
  form.set('message_header', header);
  form.set('message_body', body);
  form.set('to', to);

  let res: Response;
  try {
    res = await fetch(CLEARSTREAM_URL, {
      method: 'POST',
      headers: {
        'X-Api-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { ok: false, status: 0, detail: String((err as Error)?.message ?? err) };
  }

  const text = await res.text();
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
  return { ok: false, status: res.status, detail: text.slice(0, 300) };
}

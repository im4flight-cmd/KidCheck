/**
 * Parent paging via Clearstream (the church texting service).
 *
 * A teacher taps a child on the display, confirms once, and the server looks
 * up that child's guardian phone from CCB and sends a one-off text through
 * Clearstream's API. Nothing here runs unless PAGING_ENABLED=true, and it
 * stays in a safe test mode (logs instead of sends) until a real
 * CLEARSTREAM_API_KEY is set. Gated by the confirm tap and by the iPad's own
 * passcode/Guided Access, not by an in-app PIN.
 *
 * Clearstream API (confirmed shape, from their own structured validation
 * errors on live sends):
 *   POST https://api.getclearstream.com/v1/messages
 *   Header: X-Api-Key: <key>
 *   Form fields: message_header, message_body, subscribers[] (recipient
 *   mobile number(s) for a one-off send, an array; Clearstream is
 *   list-based, so the alternative to "subscribers" is a "lists" of saved
 *   list ids, which this app never uses).
 */

import { fetchGuardian } from '@/lib/ccb';
import { toE164 } from './phone';
import { buildMessage } from './message';

const CLEARSTREAM_URL = 'https://api.getclearstream.com/v1/messages';
const RESEND_BLOCK_MS = 60000;
const lastSent = new Map<string, number>();

// Clearstream's send response wraps the created message; tries a couple of
// plausible shapes ({data: {...}} matching their confirmed list response,
// or the object directly) rather than asserting just one.
function extractMessageId(rawBody: string): string | undefined {
  try {
    const json = JSON.parse(rawBody);
    const candidates = [json?.data?.id, json?.id];
    const found = candidates.find((v) => v !== undefined && v !== null && v !== '');
    return found !== undefined ? String(found) : undefined;
  } catch {
    return undefined;
  }
}

export type ClearstreamMessageStatus = {
  found: boolean;
  status?: string;
  delivered: boolean;
  failed: boolean;
  optedOut: boolean;
  reason?: string;
};

// Read-only delivery-status check for a message THIS APP sent, by
// Clearstream's own message id -- confirmed live 2026-09-23:
// GET .../v1/messages/<id>, and the list endpoint GET .../v1/messages
// ({data: [...]}), each message carrying stats {successful, failures,
// opt_outs, ...} and completed_at. Tries the direct per-id lookup first;
// falls back to searching the list for a matching id if that fails (a
// message may not always be individually fetchable right away).
//
// SECURITY: Clearstream's raw response for either endpoint includes OTHER
// people's contact details too (name, phone, email, signed URLs) -- a real
// vulnerability found live 2026-09-23 (a since-removed debug probe exposed
// this, unauthenticated, to anyone who found the URL). This function reads
// that raw data only in server memory and returns solely the sanitized
// shape below; it must never be changed to pass any subscriber/contact
// field through to a caller.
export async function checkClearstreamMessageStatus(id: string): Promise<ClearstreamMessageStatus> {
  const key = String(process.env.CLEARSTREAM_API_KEY ?? '');
  const notFound: ClearstreamMessageStatus = { found: false, delivered: false, failed: false, optedOut: false };
  if (!key || !/^[\w-]+$/.test(id)) return notFound;

  let msg: any = null;
  try {
    const res = await fetch(`${CLEARSTREAM_URL}/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { 'X-Api-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 200) {
      const json = await res.json().catch(() => null);
      msg = json?.data ?? json;
    }
  } catch {
    // fall through to the list search below
  }

  if (!msg) {
    try {
      const res = await fetch(CLEARSTREAM_URL, {
        method: 'GET',
        headers: { 'X-Api-Key': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 200) {
        const json = await res.json().catch(() => null);
        const list = Array.isArray(json?.data) ? json.data : [];
        msg = list.find((m: any) => String(m?.id) === String(id)) ?? null;
      }
    } catch {
      // leave msg null
    }
  }
  if (!msg) return notFound;

  const stats = msg?.stats ?? {};
  const optedOut = Number(stats?.opt_outs ?? 0) >= 1;
  const failed = optedOut || Number(stats?.failures ?? 0) >= 1;
  const delivered = !failed && Number(stats?.successful ?? 0) >= 1 && !!msg?.completed_at;

  return {
    found: true,
    status: typeof msg?.status === 'string' ? msg.status : undefined,
    delivered,
    failed,
    optedOut,
    reason: failed ? (optedOut ? 'parent has opted out of texts' : 'the number could not receive texts') : undefined,
  };
}

export function pagingEnabled(): boolean {
  return process.env.PAGING_ENABLED === 'true';
}

function senderHeader(): string {
  return String(process.env.PAGE_SENDER || 'Country Faith Church').slice(0, 30);
}

// Live only when a key is present and test mode is not forced on.
function isLive(): boolean {
  return !!process.env.CLEARSTREAM_API_KEY && process.env.PAGING_TEST !== 'true';
}

function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  return d.length >= 4 ? '••• ••• ' + d.slice(-4) : '••••';
}

export type PageResult =
  | { ok: true; dryRun: boolean; guardian: string; toMasked: string; throttled?: boolean; messageId?: string }
  | { error: string };

export async function sendPage(childId: string, room: string): Promise<PageResult> {
  if (!pagingEnabled()) return { error: 'Paging is turned off.' };

  const demo = process.env.DEMO_MODE === 'true';

  if (!demo && !/^\d+$/.test(String(childId))) return { error: 'Invalid child.' };

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
    // Surface Clearstream's own reason (it is not sensitive, no phone number
    // or key in it) so the exact fix is visible without a server log.
    const why = sent.detail ? `: ${sent.detail}` : '';
    return { error: `The text service did not accept the message (${sent.status || 'no response'})${why}` };
  }
  lastSent.set(childId, now);

  // The display polls /api/page/status?id=<messageId> afterward to confirm
  // delivery; that route re-fetches Clearstream itself and returns only a
  // sanitized status, never raw contact data.
  const messageId = extractMessageId(sent.rawBody ?? '');

  return { ok: true, dryRun: false, guardian, toMasked: maskPhone(phone), messageId };
}

async function sendClearstream(
  to: string,
  header: string,
  body: string,
): Promise<{ ok: boolean; status: number; detail?: string; rawBody?: string }> {
  const key = String(process.env.CLEARSTREAM_API_KEY ?? '');
  const form = new URLSearchParams();
  form.set('message_header', header);
  form.set('message_body', body);
  // Clearstream's own structured validation error named this field exactly:
  // "subscribers" (plural, an array), required when "lists" is not present.
  // Encoded the standard form-array way: a repeated bracketed key.
  form.append('subscribers[]', to);

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
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, rawBody: text.slice(0, 4000) };
  return { ok: false, status: res.status, detail: text.slice(0, 300), rawBody: text.slice(0, 4000) };
}

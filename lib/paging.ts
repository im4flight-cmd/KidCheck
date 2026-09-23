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

// Temporary delivery-confirmation investigation (2026-09-23): a real send's
// raw response, and one immediate read-only status lookup using whatever id
// it contains, kept in memory so a debug GET can show them. Nothing here
// ever sends a new text; this only records/reads what a real "Text parent"
// tap already did. Vercel is serverless, so this can be empty if the debug
// request lands on a different warm instance than the one that just sent --
// trigger a real send, then open the debug URL right away.
export type SendDebugRecord = {
  at: string;
  sendStatus: number;
  sendRawBody: string;
  extractedId?: string;
  statusLookupUrl?: string;
  statusLookupStatus?: number;
  statusLookupRawBody?: string;
  statusLookupError?: string;
};
const RECENT_SENDS_MAX = 10;
const recentSends: SendDebugRecord[] = [];

function recordSend(rec: SendDebugRecord) {
  recentSends.unshift(rec);
  if (recentSends.length > RECENT_SENDS_MAX) recentSends.length = RECENT_SENDS_MAX;
}

export function recentSendDebugLog(): SendDebugRecord[] {
  return recentSends;
}

// Clearstream's send response shape for a successful send is not yet
// confirmed, so this tries several plausible id-ish keys rather than
// asserting one; the full raw body is always kept regardless, so nothing is
// lost if none of these guesses match.
function extractMessageId(rawBody: string): string | undefined {
  try {
    const json = JSON.parse(rawBody);
    const candidates = [
      json?.id,
      json?.message_id,
      json?.messageId,
      json?.uuid,
      json?.data?.id,
      json?.message?.id,
      json?.data?.message_id,
    ];
    const found = candidates.find((v) => v !== undefined && v !== null && v !== '');
    return found !== undefined ? String(found) : undefined;
  } catch {
    return undefined;
  }
}

// Unconfirmed hypothesis, evidence-first: a REST-conventional detail lookup
// for a resource created at POST .../v1/messages would be
// GET .../v1/messages/<id>. A read-only GET; Clearstream's own response
// (real data, or an error naming what's wrong) says whether this guess is
// right, the same way individual_id and subscribers[] were confirmed for
// CCB and Clearstream earlier in this project.
async function lookupClearstreamStatus(
  id: string,
): Promise<{ url: string; status: number; rawBody?: string; error?: string }> {
  const key = String(process.env.CLEARSTREAM_API_KEY ?? '');
  const url = `${CLEARSTREAM_URL}/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Api-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const rawBody = await res.text();
    return { url, status: res.status, rawBody: rawBody.slice(0, 4000) };
  } catch (err) {
    return { url, status: 0, error: String((err as Error)?.message ?? err) };
  }
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
  | { ok: true; dryRun: boolean; guardian: string; toMasked: string; throttled?: boolean }
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
    recordSend({ at: new Date().toISOString(), sendStatus: sent.status, sendRawBody: sent.rawBody ?? sent.detail ?? '' });
    return { error: `The text service did not accept the message (${sent.status || 'no response'})${why}` };
  }
  lastSent.set(childId, now);

  // Temporary delivery-confirmation investigation: capture the real send's
  // raw response, and -- read-only, no new text -- one immediate status
  // lookup if a plausible message id was found in it. See recentSendDebugLog.
  const record: SendDebugRecord = {
    at: new Date().toISOString(),
    sendStatus: sent.status,
    sendRawBody: sent.rawBody ?? '',
    extractedId: extractMessageId(sent.rawBody ?? ''),
  };
  if (record.extractedId) {
    const looked = await lookupClearstreamStatus(record.extractedId);
    record.statusLookupUrl = looked.url;
    record.statusLookupStatus = looked.status;
    record.statusLookupRawBody = looked.rawBody;
    record.statusLookupError = looked.error;
  }
  recordSend(record);

  return { ok: true, dryRun: false, guardian, toMasked: maskPhone(phone) };
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

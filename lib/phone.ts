/**
 * Phone number helpers with no other dependencies, so they can be unit tested
 * directly.
 */

// Normalize a US phone to E.164 (+1XXXXXXXXXX); leave an already-international
// number (one that starts with +) as its digits with a leading +.
export function toE164(phone: string): string {
  const raw = String(phone ?? '').trim();
  if (raw.startsWith('+')) return '+' + raw.replace(/\D/g, '');
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : '';
}

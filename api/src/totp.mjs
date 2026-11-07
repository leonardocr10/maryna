// Two-step verification with an authenticator app (TOTP, RFC 6238: 30 s, 6 digits, HMAC-SHA1).
// Works with Google Authenticator, Microsoft Authenticator, Authy etc. No external service.
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const c of clean) { value = (value << 5) | ALPHABET.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(randomBytes(20));
/** Code for a 30 s step (default: now). */
export function totpAt(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15, n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/** The step of a valid code (now ±1 step, for clock drift), or null. Codes at or before lastStep are refused (no replay). */
export function verifyTotp(secret, code, lastStep = -1, now = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / 30000);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (step <= lastStep) continue;
    const a = Buffer.from(totpAt(secret, step)), b = Buffer.from(c);
    if (timingSafeEqual(a, b)) return step;
  }
  return null;
}
export const otpauthUri = (account, secret, issuer = 'NeuroLaudos') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {base32Decode, base32Encode, newSecret, otpauthUri, totpAt, verifyTotp} from '../src/totp.mjs';

// RFC 6238 test vector: secret "12345678901234567890", T = 59 s -> 94287082 (8 digits) -> 287082 with 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('base32 round trip', () => {
  const b = Buffer.from([0, 1, 2, 250, 255, 128, 7]);
  assert.deepEqual(base32Decode(base32Encode(b)), b);
  assert.equal(newSecret().length, 32);
});

test('matches the RFC 6238 test vectors', () => {
  assert.equal(totpAt(RFC_SECRET, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(RFC_SECRET, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpAt(RFC_SECRET, Math.floor(2000000000 / 30)), '279037');
});

test('accepts the current code and one step of drift, refuses replay and garbage', () => {
  const s = newSecret(), now = Date.now(), step = Math.floor(now / 30000);
  assert.equal(verifyTotp(s, totpAt(s, step), -1, now), step);
  assert.equal(verifyTotp(s, totpAt(s, step - 1), -1, now), step - 1);
  assert.equal(verifyTotp(s, totpAt(s, step - 3), -1, now), null);
  assert.equal(verifyTotp(s, totpAt(s, step), step, now), null, 'same code twice');
  assert.equal(verifyTotp(s, 'abc123', -1, now), null);
  assert.match(otpauthUri('a@b.test', s), /^otpauth:\/\/totp\/NeuroLaudos:a%40b\.test\?secret=/);
});

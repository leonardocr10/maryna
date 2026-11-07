// Encrypted backups of the whole clinic: database snapshot + encrypted DOCX storage, in one file.
// Format: "NLBK" | mode (1 = this computer's key, 2 = password) | salt(16) | nonce(12) | AES-256-GCM(gzip(payload)) | tag(16)
// payload = 4-byte manifest length | manifest JSON | file bytes, in manifest order.
// A password backup also carries FILE_ENCRYPTION_KEY inside (encrypted), so it opens on another computer.
import {createCipheriv, createDecipheriv, hkdfSync, randomBytes, scryptSync} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const MAGIC = Buffer.from('NLBK');
export const MIN_BACKUP_PASSWORD = 12;
const fail = (status, message) => Object.assign(new Error(message), {status});

function keyFor(mode, salt, {machineKey, password}) {
  if (mode === 1) { if (!/^[a-f0-9]{64}$/i.test(machineKey || '')) throw fail(500, 'Chave do computador ausente'); return Buffer.from(hkdfSync('sha256', Buffer.from(machineKey, 'hex'), salt, 'neurolaudos-backup', 32)); }
  if (typeof password !== 'string' || password.length < MIN_BACKUP_PASSWORD) throw fail(400, `A senha do backup precisa ter pelo menos ${MIN_BACKUP_PASSWORD} caracteres`);
  return scryptSync(password.normalize('NFC'), salt, 32, {N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024});
}

/** @param entries [{name, bytes}] (name 'db' is the database, 'storage/<file>' the encrypted documents) */
export function packBackup(entries, meta, keys) {
  const mode = keys.password ? 2 : 1;
  const manifest = Buffer.from(JSON.stringify({format: 1, created_at: new Date().toISOString(), ...meta, entries: entries.map(e => ({name: e.name, size: e.bytes.length}))}));
  const len = Buffer.alloc(4); len.writeUInt32BE(manifest.length);
  const plain = gzipSync(Buffer.concat([len, manifest, ...entries.map(e => e.bytes)]));
  const salt = randomBytes(16), nonce = randomBytes(12), c = createCipheriv('aes-256-gcm', keyFor(mode, salt, keys), nonce);
  return Buffer.concat([MAGIC, Buffer.from([mode]), salt, nonce, c.update(plain), c.final(), c.getAuthTag()]);
}

export function backupMode(buf) { return buf.subarray(0, 4).equals(MAGIC) ? buf[4] : 0; }

export function unpackBackup(buf, keys) {
  const mode = backupMode(buf); if (mode !== 1 && mode !== 2) throw fail(400, 'Arquivo não é um backup do NeuroLaudos');
  const salt = buf.subarray(5, 21), nonce = buf.subarray(21, 33), tag = buf.subarray(buf.length - 16), body = buf.subarray(33, buf.length - 16);
  let plain;
  try { const d = createDecipheriv('aes-256-gcm', keyFor(mode, salt, keys), nonce); d.setAuthTag(tag); plain = gunzipSync(Buffer.concat([d.update(body), d.final()])); }
  catch (e) { if (e.status) throw e; throw fail(400, mode === 2 ? 'Senha do backup incorreta ou arquivo danificado' : 'Este backup foi feito em outro computador (ou com outra chave) ou está danificado'); }
  const n = plain.readUInt32BE(0), manifest = JSON.parse(plain.subarray(4, 4 + n).toString('utf8'));
  let at = 4 + n; const entries = manifest.entries.map(e => { const bytes = plain.subarray(at, at + e.size); at += e.size; return {name: e.name, bytes}; });
  return {manifest, entries};
}

/** Restores a backup into dbFile/storageDir. What was there is moved aside (never deleted). */
export function restoreBackup(buf, {dbFile, storageDir, machineKey, password}) {
  const {manifest, entries} = unpackBackup(buf, {machineKey, password});
  const db = entries.find(e => e.name === 'db'); if (!db) throw fail(400, 'Backup sem banco de dados');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), moved = [];
  fs.mkdirSync(path.dirname(dbFile), {recursive: true});
  if (fs.existsSync(dbFile)) { const to = `${dbFile}.antes-restauracao-${stamp}`; fs.renameSync(dbFile, to); moved.push(to); }
  if (fs.existsSync(storageDir)) { const to = `${storageDir}-antes-restauracao-${stamp}`; fs.renameSync(storageDir, to); moved.push(to); }
  fs.writeFileSync(dbFile, db.bytes, {mode: 0o600});
  fs.mkdirSync(storageDir, {recursive: true, mode: 0o700});
  for (const e of entries) {
    if (!e.name.startsWith('storage/')) continue;
    const name = e.name.slice(8); if (!/^[a-f0-9-]+\.bin$/.test(name)) continue; // never write outside the storage folder
    fs.writeFileSync(path.join(storageDir, name), e.bytes, {mode: 0o600});
  }
  return {manifest, moved, fileKey: manifest.file_key || null};
}

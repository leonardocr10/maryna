import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {packBackup, unpackBackup, restoreBackup, backupMode} from '../src/backup.mjs';

const key = randomBytes(32).toString('hex');
const entries = [{name: 'db', bytes: Buffer.from('banco sintético')}, {name: 'storage/abc-123.bin', bytes: randomBytes(64)}];
const status = fn => { try { fn(); return 0; } catch (e) { return e.status; } };

test('machine-key backup round trip; another key cannot open it', () => {
  const buf = packBackup(entries, {reason: 'teste'}, {machineKey: key});
  assert.equal(backupMode(buf), 1);
  assert.ok(!buf.includes(Buffer.from('banco sintético')), 'content is encrypted');
  const out = unpackBackup(buf, {machineKey: key});
  assert.equal(out.manifest.reason, 'teste');
  assert.deepEqual(out.entries.map(e => e.bytes), entries.map(e => e.bytes));
  assert.equal(status(() => unpackBackup(buf, {machineKey: randomBytes(32).toString('hex')})), 400);
});

test('password backup: needs a long password, wrong password fails, carries the file key', () => {
  assert.equal(status(() => packBackup(entries, {}, {password: 'curta'})), 400);
  const buf = packBackup(entries, {file_key: key}, {password: 'senha-de-backup-sintetica'});
  assert.equal(backupMode(buf), 2);
  assert.equal(status(() => unpackBackup(buf, {password: 'senha-errada-sintetica'})), 400);
  assert.equal(unpackBackup(buf, {password: 'senha-de-backup-sintetica'}).manifest.file_key, key);
});

test('restore moves the current data aside and never writes outside the storage folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-restore-'));
  try {
    const dbFile = path.join(dir, 'data', 'x.db'), storageDir = path.join(dir, 'storage');
    fs.mkdirSync(path.dirname(dbFile)); fs.writeFileSync(dbFile, 'antigo'); fs.mkdirSync(storageDir); fs.writeFileSync(path.join(storageDir, 'old.bin'), 'velho');
    const evil = [...entries, {name: 'storage/../../fora.bin', bytes: Buffer.from('x')}];
    const r = restoreBackup(packBackup(evil, {}, {machineKey: key}), {dbFile, storageDir, machineKey: key});
    assert.equal(fs.readFileSync(dbFile, 'utf8'), 'banco sintético');
    assert.ok(fs.existsSync(path.join(storageDir, 'abc-123.bin')));
    assert.ok(!fs.existsSync(path.join(dir, 'fora.bin')));
    assert.equal(r.moved.length, 2);
    assert.ok(r.moved.every(m => fs.existsSync(m)), 'previous data kept');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

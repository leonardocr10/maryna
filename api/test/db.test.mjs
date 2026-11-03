// Embedded SQLite layer: same call shapes the server uses (synthetic data only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/db.mjs';

const schema = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql');

test('schema, rows, upsert, booleans, dates, transactions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-db-'));
  const db = openDatabase(path.join(dir, 'x.db'), schema);
  try {
    const [[cfg]] = await db.query('SELECT model,enabled FROM ai_settings WHERE id=1');
    assert.equal(cfg.model, 'gpt-4.1');
    await db.execute('UPDATE ai_settings SET enabled=? WHERE id=1', [true]);
    assert.equal((await db.query('SELECT enabled FROM ai_settings'))[0][0].enabled, 1);

    await db.execute('INSERT INTO prompt_templates(id,name,prompt) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt', ['a', 'a', 'um']);
    await db.execute('INSERT INTO prompt_templates(id,name,prompt) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt', ['a', 'a', 'dois']);
    assert.deepEqual((await db.query('SELECT prompt FROM prompt_templates'))[0], [{prompt: 'dois'}]);

    await db.execute('INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,?)', ['u', 'x@example.com', 'X', 'h', 'admin']);
    await db.execute('INSERT INTO patients(id,name,birth_date) VALUES(?,?,?)', ['p', 'Paciente Fictício', '2015-03-07']);
    await db.execute('INSERT INTO evaluations(id,patient_id,created_by) VALUES(?,?,?)', ['e', 'p', 'u']);
    const [res] = await db.execute('UPDATE evaluations SET approved_at=CURRENT_TIMESTAMP,approved_by=? WHERE id=?', [undefined, 'e']);
    assert.equal(res.affectedRows, 1);
    const [[e]] = await db.execute('SELECT e.*,p.birth_date FROM evaluations e JOIN patients p ON p.id=e.patient_id WHERE e.id=?', ['e']);
    assert.match(e.approved_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(e.created_at, /Z$/);
    assert.equal(e.birth_date, '2015-03-07');

    const conn = await db.getConnection();
    await conn.beginTransaction();
    await conn.execute('DELETE FROM evaluations WHERE id=?', ['e']);
    await conn.rollback();
    assert.equal((await db.query('SELECT COUNT(*) n FROM evaluations'))[0][0].n, 1);

    db.ensureColumns('patients', [['nickname', 'TEXT NULL']]);
    db.ensureColumns('patients', [['nickname', 'TEXT NULL']]);
    assert.ok((await db.query('PRAGMA table_info(patients)'))[0].some(c => c.name === 'nickname'));
    assert.equal((await db.query('PRAGMA journal_mode'))[0][0].journal_mode, 'delete');
  } finally { db.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});

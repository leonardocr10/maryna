// Route tests: the real server in its own process, an empty temporary database and storage, and a fake OpenAI
// server (OPENAI_BASE_URL). No real API call, no real patient: every name, document and text here is synthetic (AGENTS.md rule 7).
// Needs Python with python-docx, like the worker itself.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createDecipheriv, createHash, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import bcrypt from 'bcryptjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PYTHON = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const KEY = randomBytes(32).toString('hex');
const PATIENT = 'Fulano Fictício';
const ANAMNESIS_FACT = 'Relato sintético de sono agitado';
const AI_TEXT = '[PACIENTE] apresentou rotina sintética descrita pela responsável.';
const pw = {admin: 'senha-admin-sintetica-1', psy: 'senha-psi-sintetica-1', assistant: 'senha-assist-sintetica-1'};

let tmp, server, fakeAI, base, tokens = {};
const aiRequests = [];
const sha = b => createHash('sha256').update(b).digest('hex');
const db = () => new DatabaseSync(path.join(tmp, 'data.db'));

/** Writes a synthetic DOCX with python-docx: the base reuses tests/test_worker.py, the anamnesis is a few paragraphs. */
function python(code, ...args) {
  const r = spawnSync(PYTHON, ['-c', code, ...args], {cwd: ROOT, encoding: 'utf8'});
  if (r.status !== 0) throw new Error('python-docx indisponível: ' + r.stderr.slice(0, 300));
  return r.stdout;
}
const docxText = file => JSON.parse(python('import sys,json;from docx import Document;print(json.dumps([p.text for p in Document(sys.argv[1]).paragraphs]))', file));

const freePort = () => new Promise(resolve => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function api(method, url, {token, body, form} = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + url, {method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined)});
  const type = r.headers.get('content-type') || '';
  const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  return {status: r.status, data, headers: r.headers};
}
function upload(token, id, kind, bytes, filename = kind + '.docx') {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  return api('POST', `/api/evaluations/${id}/upload/${kind}`, {token, form});
}
async function newEvaluation(token = tokens.psy) {
  const p = await api('POST', '/api/patients', {token, body: {name: PATIENT}});
  const e = await api('POST', '/api/evaluations', {token, body: {patient_id: p.data.id}});
  assert.equal(e.status, 201);
  return e.data.id;
}
async function withFiles(token = tokens.psy) {
  const id = await newEvaluation(token);
  assert.equal((await upload(token, id, 'base', fs.readFileSync(path.join(tmp, 'base.docx')))).status, 201);
  assert.equal((await upload(token, id, 'anamnesis', fs.readFileSync(path.join(tmp, 'anamnese.docx')))).status, 201);
  return id;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neurolaudos-routes-'));
  python('import sys;sys.path.insert(0,"tests");from test_worker import synthetic_base;synthetic_base(sys.argv[1])', path.join(tmp, 'base.docx'));
  python('import sys;from docx import Document;d=Document();[d.add_paragraph(t) for t in sys.argv[2:]];d.save(sys.argv[1])',
    path.join(tmp, 'anamnese.docx'), 'Queixa principal', `${PATIENT} veio com a mãe.`, ANAMNESIS_FACT + ' desde o ano passado.');

  // Fake OpenAI: the model exists, and every response is a JSON text with the patient placeholder.
  fakeAI = createServer((req, res) => {
    let raw = '';
    req.on('data', d => raw += d);
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url.startsWith('/v1/models/')) return res.end(JSON.stringify({id: decodeURIComponent(req.url.slice(11)), object: 'model', owned_by: 'test'}));
      if (req.method === 'POST' && req.url === '/v1/responses') {
        aiRequests.push(raw);
        const text = JSON.stringify({text: AI_TEXT, warnings: []});
        return res.end(JSON.stringify({id: 'resp_test', object: 'response', status: 'completed', output_text: text,
          output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text, annotations: []}]}],
          usage: {input_tokens: 100, output_tokens: 20, input_tokens_details: {cached_tokens: 0}}}));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fakeAI.listen(0, '127.0.0.1', r));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  // cwd is the empty temp folder, so the developer's api/.env is never read.
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'api/src/server.mjs')], {
    cwd: tmp, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: {...process.env, ADMIN_EMAIL: '', ADMIN_PASSWORD: '', TTS_PROVIDER: '', DICTATION_ENABLED: 'false', API_RATE_LIMIT: '100000', PORT: String(port), HOST: '127.0.0.1',
      DB_FILE: path.join(tmp, 'data.db'), STORAGE_DIR: path.join(tmp, 'storage'), JWT_SECRET: randomBytes(32).toString('hex'),
      FILE_ENCRYPTION_KEY: KEY, PYTHON_BIN: PYTHON, OPENAI_API_KEY: 'sk-test-sintetica', OPENAI_BASE_URL: `http://127.0.0.1:${fakeAI.address().port}/v1`,
      AI_ENABLED: 'true', ALLOW_EXTERNAL_AI: 'true', GENERATED_TEXT_RED: 'false'},
  });
  let stderr = '';
  server.stderr.on('data', d => stderr += d);
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    if (i > 100 || server.exitCode !== null) throw new Error('API não subiu: ' + stderr.slice(0, 500));
    await new Promise(r => setTimeout(r, 100));
  }

  assert.equal((await api('POST', '/api/setup', {body: {email: 'admin@exemplo.test', name: 'Admin Sintético', password: pw.admin}})).status, 201);
  // No user-management route exists yet: the other roles go straight into the database.
  const d = db();
  for (const [id, role, password] of [['u-psy', 'psychologist', pw.psy], ['u-assist', 'assistant', pw.assistant]])
    d.prepare('INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,?)').run(id, `${role}@exemplo.test`, role, bcrypt.hashSync(password, 4), role);
  d.close();
  for (const [k, email] of [['admin', 'admin@exemplo.test'], ['psy', 'psychologist@exemplo.test'], ['assistant', 'assistant@exemplo.test']]) {
    const r = await api('POST', '/api/login', {body: {email, password: pw[k]}});
    assert.equal(r.status, 200);
    tokens[k] = r.data.token;
  }
  // Generation also needs the switch in the settings panel (checks the model on the fake account).
  assert.equal((await api('PUT', '/api/ai/settings', {token: tokens.admin, body: {model: 'gpt-4.1-mini', enabled: true}})).status, 200);
});

after(async () => {
  server?.kill();
  if (server && server.exitCode === null) await new Promise(r => server.once('exit', r));
  await new Promise(r => fakeAI ? fakeAI.close(r) : r());
  if (tmp) fs.rmSync(tmp, {recursive: true, force: true});
});

test('health answers and setup works only once', async () => {
  assert.equal((await api('GET', '/api/health')).status, 200);
  const again = await api('POST', '/api/setup', {body: {email: 'outro@exemplo.test', name: 'Outro', password: 'outra-senha-longa-1'}});
  assert.equal(again.status, 403);
});

test('login rejects a wrong password and routes reject missing or forged tokens', async () => {
  assert.equal((await api('POST', '/api/login', {body: {email: 'admin@exemplo.test', password: 'errada'}})).status, 401);
  assert.equal((await api('GET', '/api/evaluations')).status, 401);
  assert.equal((await api('GET', '/api/evaluations', {token: tokens.admin.slice(0, -2) + 'xx'})).status, 401);
});

test('assistant reads but cannot generate, edit, approve, export or delete', async () => {
  const id = await withFiles();
  assert.equal((await api('GET', `/api/evaluations/${id}`, {token: tokens.assistant})).status, 200);
  const calls = aiRequests.length;
  for (const [method, url, body] of [
    ['POST', `/api/evaluations/${id}/generate/anamnesis`, {}],
    ['PUT', `/api/evaluations/${id}/sections/anamnesis`, {content: 'Texto sintético.'}],
    ['POST', `/api/evaluations/${id}/approve`, {approveSections: true}],
    ['POST', `/api/evaluations/${id}/export`, {}],
    ['POST', `/api/evaluations/${id}/preview`, {}],
    ['DELETE', `/api/evaluations/${id}`, undefined],
    ['PUT', '/api/ai/settings', {model: 'gpt-4.1', enabled: true}],
  ]) assert.equal((await api(method, url, {token: tokens.assistant, body})).status, 403, `${method} ${url}`);
  assert.equal(aiRequests.length, calls, 'nothing reached the AI');
});

test('only an admin changes the AI settings', async () => {
  assert.equal((await api('PUT', '/api/ai/settings', {token: tokens.psy, body: {model: 'gpt-4.1', enabled: false}})).status, 403);
});

test('upload rejects files that are not Word documents', async () => {
  const id = await newEvaluation();
  assert.equal((await upload(tokens.psy, id, 'base', Buffer.from('texto qualquer'), 'base.docx')).status, 400);
  assert.equal((await upload(tokens.psy, id, 'base', Buffer.from('PK\x03\x04 corrompido'), 'base.docx')).status, 400);
  assert.equal((await upload(tokens.psy, id, 'base', fs.readFileSync(path.join(tmp, 'base.docx')), 'base.pdf')).status, 400);
  assert.equal((await upload(tokens.psy, id, 'outro', fs.readFileSync(path.join(tmp, 'base.docx')))).status, 400);
});

test('uploaded files are stored encrypted and decrypt to the exact original', async () => {
  const id = await withFiles();
  const d = db();
  const docs = d.prepare('SELECT kind,storage_path,sha256 FROM documents WHERE evaluation_id=?').all(id);
  d.close();
  assert.equal(docs.length, 2);
  for (const doc of docs) {
    const original = fs.readFileSync(path.join(tmp, doc.kind === 'base' ? 'base.docx' : 'anamnese.docx'));
    const stored = fs.readFileSync(path.join(tmp, 'storage', doc.storage_path));
    assert.notEqual(stored.subarray(0, 2).toString(), 'PK', 'not plain DOCX on disk');
    const c = createDecipheriv('aes-256-gcm', Buffer.from(KEY, 'hex'), stored.subarray(0, 12));
    c.setAuthTag(stored.subarray(stored.length - 16));
    const plain = Buffer.concat([c.update(stored.subarray(12, stored.length - 16)), c.final()]);
    assert.equal(sha(plain), sha(original));
    assert.equal(doc.sha256, sha(original));
  }
});

test('nothing is generated without both documents', async () => {
  const id = await newEvaluation();
  const calls = aiRequests.length;
  assert.equal((await api('POST', `/api/evaluations/${id}/inspect`, {token: tokens.psy})).status, 409);
  assert.equal((await api('POST', `/api/evaluations/${id}/generate/anamnesis`, {token: tokens.psy, body: {}})).status, 409);
  await upload(tokens.psy, id, 'base', fs.readFileSync(path.join(tmp, 'base.docx')));
  assert.equal((await api('POST', `/api/evaluations/${id}/generate/inteligencia`, {token: tokens.psy, body: {}})).status, 409);
  assert.equal(aiRequests.length, calls);
});

test('inspect finds the anamnesis and the interpretation markers', async () => {
  const id = await withFiles();
  const r = await api('POST', `/api/evaluations/${id}/inspect`, {token: tokens.psy});
  assert.equal(r.status, 200);
  const keys = r.data.markers.map(m => m.key);
  for (const k of ['anamnesis', 'inteligencia', 'percepcao', 'memoria', 'atencao', 'funcoes_executivas', 'comportamento']) assert.ok(keys.includes(k), k);
  assert.match(r.data.anamnesis_text, /sono agitado/);
});

test('generation sends pseudonymised data, restores names in the draft and records cost', async () => {
  const id = await withFiles();
  const from = aiRequests.length;
  const r = await api('POST', `/api/evaluations/${id}/generate/anamnesis`, {token: tokens.psy, body: {}});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sent = aiRequests.slice(from).join('\n');
  assert.ok(sent.includes(ANAMNESIS_FACT), 'anamnesis uses the anamnesis notes');
  assert.ok(!sent.includes('Fulano'), 'patient name never leaves the server');
  assert.ok(sent.includes('[PACIENTE]'));
  assert.equal(r.data.text, AI_TEXT.replace('[PACIENTE]', PATIENT));
  assert.ok(r.data.usage.input_tokens >= 100, 'usage of the fake call is recorded');
  const ev = await api('GET', `/api/evaluations/${id}`, {token: tokens.psy});
  assert.equal(ev.data.evaluation.status, 'review');
  assert.equal(ev.data.sections.find(s => s.section_key === 'anamnesis').status, 'generated');
  assert.ok(ev.data.usage.calls >= 1);
});

test('an interpretation receives only its own section, never the anamnesis', async () => {
  const id = await withFiles();
  const from = aiRequests.length;
  const r = await api('POST', `/api/evaluations/${id}/generate/inteligencia`, {token: tokens.psy, body: {}});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sent = aiRequests.slice(from).join('\n');
  assert.ok(!sent.includes('sono agitado'), 'no anamnesis text');
  assert.ok(sent.includes('Teste 0'), 'its own table');
  assert.ok(!sent.includes('Teste 2'), 'no table of another section');
});

test('editing keeps the previous version in history', async () => {
  const id = await withFiles();
  const url = `/api/evaluations/${id}/sections/anamnesis`;
  assert.equal((await api('PUT', url, {token: tokens.psy, body: {content: 'Primeira versão sintética.'}})).status, 201);
  assert.equal((await api('PUT', url, {token: tokens.psy, body: {content: 'Segunda versão sintética.'}})).status, 200);
  assert.equal((await api('PUT', url, {token: tokens.psy, body: {content: '   '}})).status, 400);
  const d = db();
  const s = d.prepare("SELECT id,version,content,status FROM sections WHERE evaluation_id=? AND section_key='anamnesis'").get(id);
  const h = d.prepare('SELECT version,content FROM section_history WHERE section_id=?').all(s.id);
  d.close();
  assert.equal(s.version, 2);
  assert.equal(s.content, 'Segunda versão sintética.');
  assert.equal(s.status, 'edited');
  assert.deepEqual(h.map(x => ({...x})), [{version: 1, content: 'Primeira versão sintética.'}]);
});

test('approval and export: blocked until approved, then the evaluation is locked and the original untouched', async () => {
  const id = await withFiles();
  const ev = `/api/evaluations/${id}`;
  // nothing written yet
  assert.equal((await api('POST', ev + '/approve', {token: tokens.psy, body: {approveSections: true}})).status, 409);
  await api('PUT', ev + '/sections/anamnesis', {token: tokens.psy, body: {content: 'Anamnese sintética revisada.'}});
  await api('PUT', ev + '/sections/inteligencia', {token: tokens.psy, body: {content: 'Interpretação sintética revisada.'}});
  assert.equal((await api('POST', ev + '/export', {token: tokens.psy})).status, 409, 'export needs approval');
  assert.equal((await api('POST', ev + '/approve', {token: tokens.psy, body: {}})).status, 409, 'sections not approved yet');

  const preview = await api('POST', ev + '/preview', {token: tokens.psy});
  assert.equal(preview.status, 200);
  assert.equal(preview.data.subarray(0, 2).toString(), 'PK');

  const ok = await api('POST', ev + '/approve', {token: tokens.psy, body: {approveSections: true}});
  assert.equal(ok.status, 200);
  const d = db();
  const row = d.prepare('SELECT status,approved_by,approved_at FROM evaluations WHERE id=?').get(id);
  d.close();
  assert.equal(row.status, 'approved');
  assert.equal(row.approved_by, 'u-psy');
  assert.ok(row.approved_at);

  // locked
  const calls = aiRequests.length;
  assert.equal((await api('PUT', ev + '/sections/anamnesis', {token: tokens.psy, body: {content: 'Alteração tardia.'}})).status, 409);
  assert.equal((await api('POST', ev + '/generate/anamnesis', {token: tokens.psy, body: {}})).status, 409);
  assert.equal((await upload(tokens.psy, id, 'base', fs.readFileSync(path.join(tmp, 'base.docx')))).status, 409);
  assert.equal((await api('PUT', ev + '/identification', {token: tokens.psy, body: {name: 'Outro Nome'}})).status, 409);
  assert.equal(aiRequests.length, calls);

  const out = await api('POST', ev + '/export', {token: tokens.psy});
  assert.equal(out.status, 200);
  const file = path.join(tmp, 'export-' + id + '.docx');
  fs.writeFileSync(file, out.data);
  const before = docxText(path.join(tmp, 'base.docx'));
  const after = docxText(file);
  assert.equal(after.filter(t => t === 'Anamnese sintética revisada.').length, 1);
  assert.equal(after.filter(t => t === 'Interpretação sintética revisada.').length, 1);
  // every paragraph of the base is still there, in order (only insertions)
  const kept = after.filter(t => !['Anamnese sintética revisada.', 'Interpretação sintética revisada.'].includes(t));
  assert.deepEqual(kept.filter(t => t !== 'Paciente: ' + PATIENT), before.filter(t => t !== 'Paciente: ' + PATIENT));
});

test('deleting an evaluation removes its encrypted files and drafts', async () => {
  const id = await withFiles();
  await api('PUT', `/api/evaluations/${id}/sections/anamnesis`, {token: tokens.psy, body: {content: 'Texto a apagar.'}});
  let d = db();
  const files = d.prepare('SELECT storage_path FROM documents WHERE evaluation_id=?').all(id).map(x => x.storage_path);
  d.close();
  assert.equal((await api('DELETE', `/api/evaluations/${id}`, {token: tokens.psy})).status, 200);
  for (const f of files) assert.ok(!fs.existsSync(path.join(tmp, 'storage', f)), f);
  d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM sections WHERE evaluation_id=?').get(id).n, 0);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM documents WHERE evaluation_id=?').get(id).n, 0);
  assert.ok(d.prepare("SELECT COUNT(*) n FROM audit_logs WHERE evaluation_id=? AND action='evaluation_deleted'").get(id).n === 1);
  d.close();
  assert.equal((await api('GET', `/api/evaluations/${id}`, {token: tokens.psy})).status, 404);
});

// ---- Accounts and roles ----
const login = (email, password) => api('POST', '/api/login', {body: {email, password}});
/** Admin creates an account with a temporary password; the person logs in and sets their own. */
async function account(email, role, temp = 'temporaria-sintetica-1', own = 'propria-senha-sintetica-1') {
  const c = await api('POST', '/api/users', {token: tokens.admin, body: {name: 'Conta Sintética', email, role, password: temp}});
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const first = await login(email, temp);
  const changed = await api('PUT', '/api/me/password', {token: first.data.token, body: {current: temp, next: own}});
  assert.equal(changed.status, 200);
  return {id: c.data.id, token: changed.data.token, password: own};
}

test('only an admin lists or creates accounts; e-mails are unique regardless of case', async () => {
  assert.equal((await api('GET', '/api/users', {token: tokens.psy})).status, 403);
  assert.equal((await api('POST', '/api/users', {token: tokens.psy, body: {name: 'X Y', email: 'x@exemplo.test', role: 'admin', password: 'qualquer-senha-1'}})).status, 403);
  const c = await api('POST', '/api/users', {token: tokens.admin, body: {name: 'Nova Psi', email: 'Nova.Psi@Exemplo.test', role: 'psychologist', password: 'temporaria-sintetica-1'}});
  assert.equal(c.status, 201);
  assert.equal(c.data.email, 'nova.psi@exemplo.test');
  assert.equal(c.data.must_change_password, true);
  assert.equal(c.data.password_hash, undefined);
  assert.equal((await api('POST', '/api/users', {token: tokens.admin, body: {name: 'Outra', email: 'NOVA.PSI@exemplo.test', role: 'assistant', password: 'temporaria-sintetica-2'}})).status, 409);
  const list = await api('GET', '/api/users', {token: tokens.admin});
  assert.equal(list.status, 200);
  assert.ok(list.data.users.some(u => u.email === 'nova.psi@exemplo.test'));
  assert.ok(list.data.users.every(u => u.password_hash === undefined));
});

test('a temporary password must be replaced before using the system', async () => {
  const temp = 'temporaria-sintetica-1';
  await api('POST', '/api/users', {token: tokens.admin, body: {name: 'Primeiro Acesso', email: 'primeiro@exemplo.test', role: 'assistant', password: temp}});
  const first = await login('PRIMEIRO@exemplo.test', temp);
  assert.equal(first.status, 200, 'e-mail is case-insensitive');
  assert.equal(first.data.must_change_password, true);
  const blocked = await api('GET', '/api/evaluations', {token: first.data.token});
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'password_change_required');
  assert.equal((await api('GET', '/api/me', {token: first.data.token})).status, 200);
  // wrong current password is 400 (the screen must not log out on it)
  assert.equal((await api('PUT', '/api/me/password', {token: first.data.token, body: {current: 'errada', next: 'nova-senha-sintetica-1'}})).status, 400);
  assert.equal((await api('PUT', '/api/me/password', {token: first.data.token, body: {current: temp, next: temp}})).status, 400);
  const ok = await api('PUT', '/api/me/password', {token: first.data.token, body: {current: temp, next: 'nova-senha-sintetica-1'}});
  assert.equal(ok.status, 200);
  assert.equal(ok.data.must_change_password, false);
  assert.equal((await api('GET', '/api/evaluations', {token: first.data.token})).status, 401, 'old session ends');
  assert.equal((await api('GET', '/api/evaluations', {token: ok.data.token})).status, 200);
});

test('deactivating an account ends its session at once and blocks login', async () => {
  const u = await account('desativar@exemplo.test', 'psychologist');
  assert.equal((await api('GET', '/api/evaluations', {token: u.token})).status, 200);
  assert.equal((await api('PUT', `/api/users/${u.id}`, {token: tokens.admin, body: {active: false}})).status, 200);
  assert.equal((await api('GET', '/api/evaluations', {token: u.token})).status, 401);
  assert.equal((await login('desativar@exemplo.test', u.password)).status, 403);
  assert.equal((await api('PUT', `/api/users/${u.id}`, {token: tokens.admin, body: {active: true}})).status, 200);
  assert.equal((await login('desativar@exemplo.test', u.password)).status, 200);
});

test('a role change applies to the open session, without a new login', async () => {
  const u = await account('papel@exemplo.test', 'psychologist');
  const id = await withFiles(u.token);
  assert.equal((await api('POST', `/api/evaluations/${id}/preview`, {token: u.token})).status, 200);
  assert.equal((await api('PUT', `/api/users/${u.id}`, {token: tokens.admin, body: {role: 'assistant'}})).status, 200);
  assert.equal((await api('POST', `/api/evaluations/${id}/preview`, {token: u.token})).status, 403);
  assert.equal((await api('GET', `/api/evaluations/${id}`, {token: u.token})).status, 200, 'still reads');
});

test('an admin reset sets a temporary password and ends open sessions', async () => {
  const u = await account('reset@exemplo.test', 'assistant');
  const r = await api('POST', `/api/users/${u.id}/password`, {token: tokens.admin, body: {password: 'redefinida-sintetica-1'}});
  assert.equal(r.status, 200);
  assert.equal(r.data.must_change_password, true);
  assert.equal((await api('GET', '/api/evaluations', {token: u.token})).status, 401);
  assert.equal((await login('reset@exemplo.test', u.password)).status, 401, 'old password no longer works');
  const again = await login('reset@exemplo.test', 'redefinida-sintetica-1');
  assert.equal(again.data.must_change_password, true);
  assert.equal((await api('POST', `/api/users/${u.id}/password`, {token: tokens.admin, body: {password: 'curta'}})).status, 400);
});

test('an admin cannot lock themselves out', async () => {
  const me = (await api('GET', '/api/me', {token: tokens.admin})).data;
  assert.equal((await api('PUT', `/api/users/${me.id}`, {token: tokens.admin, body: {active: false}})).status, 409);
  assert.equal((await api('PUT', `/api/users/${me.id}`, {token: tokens.admin, body: {role: 'psychologist'}})).status, 409);
  assert.equal((await api('POST', `/api/users/${me.id}/password`, {token: tokens.admin, body: {password: 'outra-senha-sintetica'}})).status, 409);
  assert.equal((await api('PUT', '/api/users/nao-existe', {token: tokens.admin, body: {active: false}})).status, 404);
  // still an active admin
  assert.equal((await api('GET', '/api/users', {token: tokens.admin})).status, 200);
});

// ---- Autosave and review workflow ----
test('autosave edits by the same person collapse into one version', async () => {
  const id = await withFiles();
  const url = `/api/evaluations/${id}/sections/anamnesis`;
  await api('PUT', url, {token: tokens.psy, body: {content: 'Versão inicial sintética.'}});
  await api('PUT', url, {token: tokens.psy, body: {content: 'Primeira pausa.', merge: true}});
  const r = await api('PUT', url, {token: tokens.psy, body: {content: 'Segunda pausa.', merge: true}});
  assert.equal(r.data.merged, true);
  await api('PUT', url, {token: tokens.psy, body: {content: 'Texto final sintético.', merge: true}});
  const d = db();
  const s = d.prepare("SELECT id,version,content FROM sections WHERE evaluation_id=? AND section_key='anamnesis'").get(id);
  const h = d.prepare('SELECT content FROM section_history WHERE section_id=? ORDER BY id').all(s.id).map(x => x.content);
  d.close();
  assert.equal(s.content, 'Texto final sintético.');
  assert.equal(s.version, 2);
  assert.deepEqual(h, ['Versão inicial sintética.'], 'only the text before the editing session is kept as a version');
  // approving is never merged: it is its own version
  await api('PUT', url, {token: tokens.psy, body: {content: 'Texto final sintético.', approve: true, merge: true}});
  const d2 = db();
  assert.equal(d2.prepare("SELECT status FROM sections WHERE evaluation_id=? AND section_key='anamnesis'").get(id).status, 'approved');
  d2.close();
});

test('review workflow: send, ask for correction, resolve, send again', async () => {
  const id = await newEvaluation(tokens.assistant);
  const ev = `/api/evaluations/${id}`;
  assert.equal((await api('POST', ev + '/submit', {token: tokens.assistant})).status, 409, 'needs both files');
  await upload(tokens.assistant, id, 'base', fs.readFileSync(path.join(tmp, 'base.docx')));
  await upload(tokens.assistant, id, 'anamnesis', fs.readFileSync(path.join(tmp, 'anamnese.docx')));
  const sent = await api('POST', ev + '/submit', {token: tokens.assistant});
  assert.equal(sent.status, 200);
  assert.ok(sent.data.submitted_at);
  let row = (await api('GET', '/api/evaluations', {token: tokens.psy})).data.find(e => e.id === id);
  assert.ok(row.submitted_at);
  assert.equal(Number(row.open_notes), 0);

  assert.equal((await api('POST', ev + '/notes', {token: tokens.assistant, body: {text: 'Pedido indevido'}})).status, 403, 'only the psychologist asks for corrections');
  const asked = await api('POST', ev + '/notes', {token: tokens.psy, body: {text: 'Falta a tabela sintética do teste.'}});
  assert.equal(asked.status, 201);
  assert.equal(asked.data.submitted_at, null, 'goes back to whoever prepared it');
  row = (await api('GET', '/api/evaluations', {token: tokens.assistant})).data.find(e => e.id === id);
  assert.equal(Number(row.open_notes), 1);
  assert.equal((await api('POST', ev + '/submit', {token: tokens.assistant})).status, 409, 'open request blocks sending again');

  const note = asked.data.notes[0];
  const done = await api('POST', `${ev}/notes/${note.id}/resolve`, {token: tokens.assistant, body: {}});
  assert.equal(done.status, 200);
  assert.ok(done.data.notes[0].resolved_at);
  assert.equal((await api('POST', ev + '/submit', {token: tokens.assistant})).status, 200);
  assert.equal((await api('POST', `${ev}/notes/nao-existe/resolve`, {token: tokens.assistant, body: {}})).status, 404);
  // deleting the evaluation takes its notes too
  assert.equal((await api('DELETE', ev, {token: tokens.psy})).status, 200);
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM review_notes WHERE evaluation_id=?').get(id).n, 0);
  d.close();
});

// ---- Checks, versions, standard texts, password requests ----
test('inspect reports consistency checks', async () => {
  const id = await withFiles();
  // the synthetic base has no identification fields; a swapped date range is an error
  await api('PUT', `/api/evaluations/${id}/identification`, {token: tokens.psy, body: {name: PATIENT, start_date: '2025-09-01', end_date: '2025-08-01'}});
  const r = await api('POST', `/api/evaluations/${id}/inspect`, {token: tokens.psy});
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.checks));
  assert.ok(r.data.checks.some(c => c.level === 'danger' && /Datas trocadas/.test(c.text)));
});

test('section versions can be listed and restored without losing the current text', async () => {
  const id = await withFiles();
  const url = `/api/evaluations/${id}/sections/anamnesis`;
  await api('PUT', url, {token: tokens.psy, body: {content: 'Primeiro texto sintético.'}});
  await api('PUT', url, {token: tokens.psy, body: {content: 'Segundo texto sintético.'}});
  const h = await api('GET', url + '/history', {token: tokens.assistant});
  assert.equal(h.status, 200, 'any role reads the versions');
  assert.equal(h.data.current.content, 'Segundo texto sintético.');
  assert.deepEqual(h.data.versions.map(v => v.content), ['Primeiro texto sintético.']);
  assert.equal((await api('POST', url + '/restore', {token: tokens.assistant, body: {version: 1}})).status, 403);
  assert.equal((await api('POST', url + '/restore', {token: tokens.psy, body: {version: 99}})).status, 404);
  assert.equal((await api('POST', url + '/restore', {token: tokens.psy, body: {version: 1}})).status, 200);
  const after = await api('GET', url + '/history', {token: tokens.psy});
  assert.equal(after.data.current.content, 'Primeiro texto sintético.');
  assert.equal(after.data.current.status, 'edited');
  assert.deepEqual(after.data.versions.map(v => v.content), ['Segundo texto sintético.', 'Primeiro texto sintético.']);
});

test('standard texts: the psychologist manages them, everyone reads them', async () => {
  assert.equal((await api('POST', '/api/snippets', {token: tokens.assistant, body: {title: 'Xx', text: 'Yy'}})).status, 403);
  assert.equal((await api('POST', '/api/snippets', {token: tokens.psy, body: {title: 'Ok', text: 'Texto', section_key: 'nao-existe'}})).status, 400);
  const c = await api('POST', '/api/snippets', {token: tokens.psy, body: {title: 'Encaminhamento sintético', text: 'Recomenda-se acompanhamento sintético.', section_key: 'recomendacoes'}});
  assert.equal(c.status, 201);
  assert.ok((await api('GET', '/api/snippets', {token: tokens.assistant})).data.some(s => s.id === c.data.id));
  assert.equal((await api('PUT', `/api/snippets/${c.data.id}`, {token: tokens.psy, body: {title: 'Encaminhamento', text: 'Novo texto sintético.'}})).status, 200);
  assert.equal((await api('DELETE', `/api/snippets/${c.data.id}`, {token: tokens.psy})).status, 200);
  assert.equal((await api('DELETE', `/api/snippets/${c.data.id}`, {token: tokens.psy})).status, 404);
});

test('forgot password: same answer for any e-mail, the admin sees the request, a reset clears it', async () => {
  const u = await account('esqueci@exemplo.test', 'assistant');
  assert.equal((await api('POST', '/api/password-requests', {body: {email: 'ninguem@exemplo.test'}})).status, 202);
  assert.equal((await api('POST', '/api/password-requests', {body: {email: 'ESQUECI@exemplo.test'}})).status, 202);
  assert.equal((await api('POST', '/api/password-requests', {body: {email: 'esqueci@exemplo.test'}})).status, 202, 'repeated request is fine');
  let row = (await api('GET', '/api/users', {token: tokens.admin})).data.users.find(x => x.id === u.id);
  assert.ok(row.reset_requested_at);
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM password_requests WHERE user_id=? AND handled_at IS NULL').get(u.id).n, 1, 'one open request per person');
  d.close();
  await api('POST', `/api/users/${u.id}/password`, {token: tokens.admin, body: {password: 'redefinida-sintetica-2'}});
  row = (await api('GET', '/api/users', {token: tokens.admin})).data.users.find(x => x.id === u.id);
  assert.equal(row.reset_requested_at, null);
});

test('a re-evaluation is a new evaluation of the same patient', async () => {
  const first = await withFiles();
  const list = (await api('GET', '/api/evaluations', {token: tokens.psy})).data;
  const patient = list.find(e => e.id === first).patient_id;
  const again = await api('POST', '/api/evaluations', {token: tokens.assistant, body: {patient_id: patient, sex: 'Feminino', start_date: '2026-01-10'}});
  assert.equal(again.status, 201);
  const both = (await api('GET', '/api/evaluations', {token: tokens.psy})).data.filter(e => e.patient_id === patient);
  assert.equal(both.length, 2);
  assert.ok(both.every(e => 'model_name' in e && 'open_notes' in e));
});

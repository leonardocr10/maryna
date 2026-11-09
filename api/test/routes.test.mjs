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
      AI_ENABLED: 'true', ALLOW_EXTERNAL_AI: 'true', CHATGPT_MCP_ENABLED: 'true', PUBLIC_BASE_URL: base, TTS_WARMUP: 'false', BACKUP_DIR: path.join(tmp, 'backups'), BACKUP_AUTO: 'false', GENERATED_TEXT_RED: 'false'},
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

test('natural voices: online ones only when authorized, local Piper models when installed', async () => {
  assert.equal((await api('GET', '/api/tts/voices')).status, 401);
  const r = await api('GET', '/api/tts/voices', {token: tokens.assistant});
  assert.equal(r.status, 200);
  // the test server runs with TTS_PROVIDER empty: no online voice is offered
  assert.ok(r.data.voices.every(v => v.local && v.id.startsWith('local:pt_BR-')));
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

test('a section missing from the base is created in the Word only when the psychologist chooses it', async () => {
  const id = await withFiles();
  const ev = `/api/evaluations/${id}`;
  // the synthetic base has no "Indicações e recomendações" section
  await api('PUT', ev + '/sections/recomendacoes', {token: tokens.psy, body: {content: 'Recomendação sintética criada.'}});
  const text = async () => { const r = await api('POST', ev + '/preview', {token: tokens.psy}); const f = path.join(tmp, 'created-' + id + '.docx'); fs.writeFileSync(f, r.data); return docxText(f); };
  assert.ok(!(await text()).includes('Recomendação sintética criada.'), 'not chosen: stays out of the Word');
  assert.equal((await api('PUT', ev + '/created-sections', {token: tokens.assistant, body: {key: 'recomendacoes'}})).status, 403);
  assert.equal((await api('PUT', ev + '/created-sections', {token: tokens.psy, body: {key: 'nada'}})).status, 400);
  const on = await api('PUT', ev + '/created-sections', {token: tokens.psy, body: {key: 'recomendacoes'}});
  assert.deepEqual(on.data.created_sections, ['recomendacoes']);
  const after = await text(), before = docxText(path.join(tmp, 'base.docx'));
  const i = after.indexOf('INDICAÇÕES E RECOMENDAÇÕES');
  assert.ok(i >= 0 && after[i + 1] === 'Recomendação sintética criada.');
  // only insertions: every base paragraph is kept, in order
  const added = ['INDICAÇÕES E RECOMENDAÇÕES', 'Recomendação sintética criada.', ''];
  const kept = after.filter((t, j) => !(j >= i && j < i + 3 && added.includes(t)));
  assert.deepEqual(kept.filter(t => t !== 'Paciente: ' + PATIENT), before.filter(t => t !== 'Paciente: ' + PATIENT));
  const off = await api('PUT', ev + '/created-sections', {token: tokens.psy, body: {key: 'recomendacoes', create: false}});
  assert.deepEqual(off.data.created_sections, []);
  assert.ok(!(await text()).includes('INDICAÇÕES E RECOMENDAÇÕES'));
  // excluded by the psychologist (approved exception to rule 2): the section leaves the Word copy, the base file stays
  assert.equal((await api('PUT', ev + '/excluded-sections', {token: tokens.assistant, body: {key: 'anamnesis'}})).status, 403);
  assert.equal((await api('PUT', ev + '/excluded-sections', {token: tokens.psy, body: {key: 'nada'}})).status, 400);
  assert.ok((await text()).includes('ANAMNESE'));
  const ex = await api('PUT', ev + '/excluded-sections', {token: tokens.psy, body: {key: 'anamnesis'}});
  assert.deepEqual(ex.data.excluded_sections, ['anamnesis']);
  assert.ok(!(await text()).includes('ANAMNESE'));
  assert.deepEqual(docxText(path.join(tmp, 'base.docx')), before);
  const back = await api('PUT', ev + '/excluded-sections', {token: tokens.psy, body: {key: 'anamnesis', exclude: false}});
  assert.deepEqual(back.data.excluded_sections, []);
  assert.ok((await text()).includes('ANAMNESE'));
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

// ---- Devolutiva ----
test('devolutiva: only from the approved report, pseudonymised, approved before the Word file', async () => {
  const id = await withFiles();
  const ev = `/api/evaluations/${id}`;
  assert.equal((await api('POST', ev + '/devolutiva/generate', {token: tokens.psy, body: {}})).status, 409, 'report must be approved first');
  await api('PUT', ev + '/sections/anamnesis', {token: tokens.psy, body: {content: 'Anamnese sintética que não vai para a devolutiva.'}});
  await api('PUT', ev + '/sections/inteligencia', {token: tokens.psy, body: {content: 'Interpretação sintética de habilidades.'}});
  await api('PUT', ev + '/sections/conclusao', {token: tokens.psy, body: {content: `Conclusão sintética sobre ${PATIENT}.`}});
  assert.equal((await api('POST', ev + '/approve', {token: tokens.psy, body: {approveSections: true}})).status, 200);

  assert.equal((await api('POST', ev + '/devolutiva/generate', {token: tokens.assistant, body: {}})).status, 403);
  const from = aiRequests.length;
  const g = await api('POST', ev + '/devolutiva/generate', {token: tokens.psy, body: {audience: 'familia', notes: 'Tom breve.'}});
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const sent = aiRequests.slice(from).join('\n');
  assert.ok(sent.includes('Conclusão sintética'), 'uses the approved conclusion');
  assert.ok(sent.includes('Interpretação sintética'), 'uses the approved interpretations');
  assert.ok(!sent.includes('Anamnese sintética'), 'never the anamnesis section');
  assert.ok(!sent.includes('sono agitado'), 'never the anamnesis notes');
  assert.ok(!sent.includes('Teste 0'), 'never the raw tables');
  assert.ok(!sent.includes('Fulano'), 'names are pseudonymised');
  assert.ok(sent.includes('devolutivas de avaliações'), 'own system prompt (plain language)');
  assert.equal(g.data.devolutiva.status, 'draft');
  assert.equal(g.data.devolutiva.content, AI_TEXT.replace('[PACIENTE]', PATIENT));

  assert.equal((await api('POST', ev + '/devolutiva/export', {token: tokens.psy})).status, 409, 'no Word file before approval');
  const edited = await api('PUT', ev + '/devolutiva', {token: tokens.psy, body: {content: '## Pontos fortes\n\nTexto sintético revisado pela psicóloga.'}});
  assert.equal(edited.data.devolutiva.version, 2);
  const ok = await api('PUT', ev + '/devolutiva', {token: tokens.psy, body: {content: edited.data.devolutiva.content, approve: true}});
  assert.equal(ok.data.devolutiva.status, 'approved');
  assert.equal(ok.data.devolutiva.approved_by, 'u-psy');
  assert.equal((await api('PUT', ev + '/devolutiva', {token: tokens.psy, body: {content: 'Mudança depois de aprovada, sintética.'}})).status, 409);
  assert.equal((await api('POST', ev + '/devolutiva/generate', {token: tokens.psy, body: {}})).status, 409);

  const out = await api('POST', ev + '/devolutiva/export', {token: tokens.psy});
  assert.equal(out.status, 200);
  const file = path.join(tmp, 'devolutiva-' + id + '.docx');
  fs.writeFileSync(file, out.data);
  const paras = docxText(file);
  assert.ok(paras.includes('Pontos fortes'));
  assert.ok(paras.includes('Texto sintético revisado pela psicóloga.'));
  assert.equal((await api('POST', ev + '/devolutiva/export', {token: tokens.assistant})).status, 403);

  assert.equal((await api('POST', ev + '/devolutiva/reopen', {token: tokens.psy})).data.devolutiva.status, 'draft');
  assert.equal((await api('DELETE', ev, {token: tokens.psy})).status, 200);
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM devolutivas WHERE evaluation_id=?').get(id).n, 0);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM devolutiva_history WHERE evaluation_id=?').get(id).n, 0);
  d.close();
});

// ---- Consent, plan, sessions, backup, retention ----
test('a manual evaluation calls the AI only for a section the person picks; switching back to AI allows it', async () => {
  const id = await withFiles();
  assert.equal((await api('PUT', `/api/evaluations/${id}/mode`, {token: tokens.assistant, body: {mode: 'manual'}})).status, 403);
  assert.equal((await api('PUT', `/api/evaluations/${id}/mode`, {token: tokens.psy, body: {mode: 'outro'}})).status, 400);
  assert.equal((await api('PUT', `/api/evaluations/${id}/mode`, {token: tokens.psy, body: {mode: 'manual'}})).status, 200);
  assert.equal((await api('GET', `/api/evaluations/${id}`, {token: tokens.psy})).data.evaluation.ai_mode, 'manual');
  const calls = aiRequests.length;
  const r = await api('POST', `/api/evaluations/${id}/generate/anamnesis`, {token: tokens.psy, body: {}});
  assert.equal(r.status, 409);
  assert.match(r.data.error, /manual/);
  assert.equal((await api('POST', `/api/evaluations/${id}/prompt/anamnesis`, {token: tokens.psy, body: {}})).status, 409, 'ChatGPT request too');
  assert.equal(aiRequests.length, calls);
  // the professional still writes the section by hand
  assert.ok([200, 201].includes((await api('PUT', `/api/evaluations/${id}/sections/anamnesis`, {token: tokens.psy, body: {content: 'Texto escrito à mão, fictício.'}})).status));
  // a section the person explicitly chose goes to the AI (API, ChatGPT request or ChatGPT task); nothing else does
  assert.equal((await api('POST', `/api/evaluations/${id}/generate/anamnesis`, {token: tokens.psy, body: {manual_ai: true}})).status, 200);
  assert.equal(aiRequests.length, calls + 1, 'only the chosen section');
  assert.equal((await api('POST', `/api/evaluations/${id}/prompt/anamnesis`, {token: tokens.psy, body: {manual_ai: true}})).status, 200);
  assert.equal((await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste'}})).status, 409);
  assert.equal((await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'mcp', manual_ai: true}})).status, 201);
  assert.equal((await api('GET', `/api/evaluations/${id}`, {token: tokens.psy})).data.evaluation.ai_mode, 'manual', 'the evaluation stays manual');
  await api('PUT', `/api/evaluations/${id}/mode`, {token: tokens.psy, body: {mode: 'ai'}});
  assert.equal((await api('POST', `/api/evaluations/${id}/generate/anamnesis`, {token: tokens.psy, body: {}})).status, 200);
});

test('fixed parts of the base document can be rewritten by hand, never by the AI', async () => {
  const id = await withFiles();
  assert.ok([200, 201].includes((await api('PUT', `/api/evaluations/${id}/sections/fixo_fontes_fundamentais`, {token: tokens.psy, body: {content: 'Fontes fictícias reescritas.'}})).status));
  assert.equal((await api('PUT', `/api/evaluations/${id}/sections/fixo_`, {token: tokens.psy, body: {content: 'x'}})).status, 400);
  assert.equal((await api('PUT', `/api/evaluations/${id}/sections/qualquer`, {token: tokens.psy, body: {content: 'x'}})).status, 400);
  assert.equal((await api('POST', `/api/evaluations/${id}/generate/fixo_fontes_fundamentais`, {token: tokens.psy, body: {}})).status, 400);
  assert.equal((await api('POST', `/api/evaluations/${id}/generate/hipotese`, {token: tokens.psy, body: {}})).status, 409);
});

test('a manual evaluation starts with the text of the uploaded files', async () => {
  const id = await withFiles();
  await api('PUT', `/api/evaluations/${id}/mode`, {token: tokens.psy, body: {mode: 'manual'}});
  const calls = aiRequests.length;
  const r = await api('POST', `/api/evaluations/${id}/inspect`, {token: tokens.psy});
  assert.equal(r.status, 200);
  assert.ok(r.data.synced >= 1);
  const sections = (await api('GET', `/api/evaluations/${id}`, {token: tokens.psy})).data.sections;
  const ana = sections.find(x => x.section_key === 'anamnesis');
  assert.ok(ana?.content?.trim(), 'anamnesis copied from the anamnesis document');
  assert.equal(ana.source_summary, 'from_file');
  assert.equal(aiRequests.length, calls, 'no AI call');
  // a second inspection changes nothing
  assert.equal((await api('POST', `/api/evaluations/${id}/inspect`, {token: tokens.psy})).data.synced, 0);
});

test('an evaluation can be created as manual', async () => {
  const p = await api('POST', '/api/patients', {token: tokens.psy, body: {name: 'Paciente Fictício Manual'}});
  const e = await api('POST', '/api/evaluations', {token: tokens.psy, body: {patient_id: p.data.id, ai_mode: 'manual'}});
  assert.equal(e.status, 201);
  assert.equal((await api('GET', `/api/evaluations/${e.data.id}`, {token: tokens.psy})).data.evaluation.ai_mode, 'manual');
});

test('assessment plan and sessions', async () => {
  const id = await withFiles();
  const ev = `/api/evaluations/${id}`;
  assert.equal((await api('POST', ev + '/plan', {token: tokens.assistant, body: {instrument: 'RAVLT'}})).status, 403, 'the psychologist plans');
  let p = (await api('POST', ev + '/plan', {token: tokens.psy, body: {instruments: ['Teste 0', 'Stroop', 'stroop']}})).data;
  assert.deepEqual(p.items.map(i => i.instrument), ['Teste 0', 'Stroop'], 'no duplicates');
  assert.ok(p.catalog.includes('RAVLT'));
  p = (await api('POST', ev + '/sessions', {token: tokens.assistant, body: {date: '2026-11-20', time: '14:00', kind: 'aplicacao'}})).data;
  const sid = p.sessions[0].id;
  const stroop = p.items.find(i => i.instrument === 'Stroop');
  p = (await api('PUT', `${ev}/plan/${stroop.id}`, {token: tokens.assistant, body: {status: 'applied', session_id: sid}})).data;
  assert.equal(p.items.find(i => i.id === stroop.id).applied_by_name, 'assistant');
  // the base has "Teste 0" but no Stroop results: inspect warns
  const ins = await api('POST', ev + '/inspect', {token: tokens.psy});
  assert.ok(ins.data.checks.some(c => /sem resultados no arquivo base: Stroop/.test(c.text)));
  assert.ok(ins.data.checks.some(c => c.level === 'info' && /Teste 0/.test(c.text)));
  const week = await api('GET', '/api/sessions?from=2026-11-01&to=2026-11-30', {token: tokens.assistant});
  assert.ok(week.data.some(s => s.id === sid && s.patient_name === PATIENT));
  assert.equal((await api('POST', ev + '/sessions', {token: tokens.psy, body: {date: 'amanhã'}})).status, 400);
  assert.equal((await api('DELETE', `${ev}/sessions/${sid}`, {token: tokens.assistant})).status, 200);
  assert.equal((await api('DELETE', ev, {token: tokens.psy})).status, 200);
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM evaluation_plan WHERE evaluation_id=?').get(id).n, 0);
  d.close();
});

test('backups: admin only, encrypted, restorable; password copy opens elsewhere', async () => {
  const {unpackBackup, restoreBackup} = await import('../src/backup.mjs');
  await withFiles();
  assert.equal((await api('POST', '/api/backups', {token: tokens.psy})).status, 403);
  const made = await api('POST', '/api/backups', {token: tokens.admin});
  assert.equal(made.status, 201);
  const file = path.join(tmp, 'backups', made.data.name);
  const buf = fs.readFileSync(file);
  assert.ok(!buf.includes(Buffer.from(PATIENT)), 'patient data is not readable in the file');
  const listed = (await api('GET', '/api/backups', {token: tokens.admin})).data;
  assert.equal(listed.backups[0].name, made.data.name);
  // restore into an empty folder and read the database
  const dir = fs.mkdtempSync(path.join(tmp, 'restore-'));
  const r = restoreBackup(buf, {dbFile: path.join(dir, 'x.db'), storageDir: path.join(dir, 'storage'), machineKey: KEY});
  const restored = new DatabaseSync(path.join(dir, 'x.db'));
  const live = db();
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM evaluations').get().n, r.manifest.counts.evaluations);
  assert.ok(restored.prepare('SELECT COUNT(*) n FROM evaluations').get().n >= 1);
  assert.equal(fs.readdirSync(path.join(dir, 'storage')).length, live.prepare('SELECT COUNT(*) n FROM documents').get().n);
  restored.close(); live.close();
  // password copy
  assert.equal((await api('POST', '/api/backups/export', {token: tokens.admin, body: {password: 'curta'}})).status, 400);
  const copy = await api('POST', '/api/backups/export', {token: tokens.admin, body: {password: 'senha-backup-sintetica'}});
  assert.equal(copy.status, 200);
  const opened = unpackBackup(copy.data, {password: 'senha-backup-sintetica'});
  assert.equal(opened.manifest.file_key, KEY, 'carries the documents key');
});

test('retention lists approved reports past the keeping period', async () => {
  const id = await withFiles();
  await api('PUT', `/api/evaluations/${id}/sections/anamnesis`, {token: tokens.psy, body: {content: 'Texto sintético.'}});
  await api('POST', `/api/evaluations/${id}/approve`, {token: tokens.psy, body: {approveSections: true}});
  const d = db();
  d.prepare("UPDATE evaluations SET approved_at='2015-01-10T10:00:00Z' WHERE id=?").run(id);
  d.close();
  assert.equal((await api('GET', '/api/retention', {token: tokens.assistant})).status, 403);
  const r = await api('GET', '/api/retention', {token: tokens.psy});
  assert.equal(r.data.years, 5);
  const row = r.data.expired.find(x => x.id === id);
  assert.equal(row.keep_until, '2020-01-10');
});

// ---- AI quality, previous evaluation, instrument library, delivery, audit, two-step verification ----
test('AI quality measures how much the approved text differs from the AI one', async () => {
  const id = await withFiles();
  await api('POST', `/api/evaluations/${id}/generate/inteligencia`, {token: tokens.psy, body: {}});
  await api('PUT', `/api/evaluations/${id}/sections/inteligencia`, {token: tokens.psy, body: {content: 'Texto inteiramente reescrito pela psicóloga sintética.', approve: true}});
  assert.equal((await api('GET', '/api/stats/ai-quality', {token: tokens.assistant})).status, 403);
  const q = (await api('GET', '/api/stats/ai-quality', {token: tokens.psy})).data.sections.find(s => s.section_key === 'inteligencia');
  assert.ok(q && q.texts >= 1 && q.max_changed === 100, JSON.stringify(q));
  assert.equal(q.name, 'Habilidades intelectuais');
});

test('re-evaluation shows the previous approved texts of the same patient', async () => {
  const first = await withFiles();
  await api('PUT', `/api/evaluations/${first}/sections/anamnesis`, {token: tokens.psy, body: {content: 'Anamnese anterior sintética.'}});
  await api('POST', `/api/evaluations/${first}/approve`, {token: tokens.psy, body: {approveSections: true}});
  const patient = (await api('GET', `/api/evaluations/${first}`, {token: tokens.psy})).data.evaluation.patient_id;
  const second = (await api('POST', '/api/evaluations', {token: tokens.psy, body: {patient_id: patient}})).data.id;
  const r = await api('GET', `/api/evaluations/${second}/previous`, {token: tokens.assistant});
  assert.equal(r.data.previous.id, first);
  assert.equal(r.data.previous.sections.anamnesis, 'Anamnese anterior sintética.');
  assert.equal((await api('GET', `/api/evaluations/${first}/previous`, {token: tokens.psy})).data.previous, null, 'nothing before the first');
});

test('the clinic guide of an instrument replaces the default one in the request', async () => {
  const list = (await api('GET', '/api/instruments', {token: tokens.assistant})).data;
  const stroop = list.find(i => i.id === 'stroop');
  assert.ok(stroop.default_guide.length > 30);
  assert.equal((await api('PUT', '/api/instruments/stroop', {token: tokens.assistant, body: {guide: 'x'.repeat(40)}})).status, 403);
  assert.equal((await api('PUT', '/api/instruments/stroop', {token: tokens.psy, body: {guide: 'curto'}})).status, 400);
  // the synthetic base has no instrument names, so the stored override is checked (instrumentGuides itself is unit tested)
  assert.equal((await api('PUT', '/api/instruments/stroop', {token: tokens.psy, body: {guide: 'GUIA DA CLÍNICA SINTÉTICO para o Stroop, com mais de trinta caracteres.'}})).status, 200);
  assert.match((await api('GET', '/api/instruments', {token: tokens.psy})).data.find(i => i.id === 'stroop').custom_guide, /GUIA DA CLÍNICA/);
  assert.equal((await api('PUT', '/api/instruments/stroop', {token: tokens.psy, body: {guide: ''}})).status, 200);
  assert.equal((await api('GET', '/api/instruments', {token: tokens.psy})).data.find(i => i.id === 'stroop').custom_guide, null);
});

test('delivery of the approved report is recorded', async () => {
  const id = await withFiles();
  const url = `/api/evaluations/${id}/delivery`;
  assert.equal((await api('PUT', url, {token: tokens.psy, body: {delivered_to: 'Responsáveis sintéticos'}})).status, 409, 'only after approval');
  await api('PUT', `/api/evaluations/${id}/sections/anamnesis`, {token: tokens.psy, body: {content: 'Texto sintético.'}});
  await api('POST', `/api/evaluations/${id}/approve`, {token: tokens.psy, body: {approveSections: true}});
  assert.equal((await api('PUT', url, {token: tokens.assistant, body: {delivered_to: 'X'}})).status, 403);
  const r = await api('PUT', url, {token: tokens.psy, body: {date: '2026-11-10', delivered_to: 'Responsáveis sintéticos', mode: 'presencial'}});
  assert.equal(r.data.delivered_at, '2026-11-10');
  const row = (await api('GET', '/api/evaluations', {token: tokens.psy})).data.find(e => e.id === id);
  assert.equal(row.delivered_to, 'Responsáveis sintéticos');
  assert.equal((await api('PUT', url, {token: tokens.psy, body: {clear: true}})).data.delivered_at, null);
});

test('audit trail: admin only, records who opened an evaluation once per hour', async () => {
  const id = await withFiles();
  await api('GET', `/api/evaluations/${id}`, {token: tokens.assistant});
  await api('GET', `/api/evaluations/${id}`, {token: tokens.assistant});
  assert.equal((await api('GET', '/api/audit', {token: tokens.psy})).status, 403);
  const r = await api('GET', `/api/audit?evaluation=${id}&action=opened`, {token: tokens.admin});
  assert.equal(r.status, 200);
  assert.equal(r.data.rows.filter(x => x.actor_name === 'assistant').length, 1);
  assert.equal(r.data.rows[0].patient_name, PATIENT);
  const all = await api('GET', `/api/audit?evaluation=${id}&limit=2`, {token: tokens.admin});
  assert.ok(all.data.total >= 3 && all.data.rows.length === 2);
});

test('two-step verification: setup, login with code, no replay, admin reset', async () => {
  const {totpAt} = await import('../src/totp.mjs');
  const u = await account('duas-etapas@exemplo.test', 'psychologist');
  const setup = await api('POST', '/api/me/mfa/setup', {token: u.token});
  assert.match(setup.data.uri, /^otpauth:\/\/totp\//);
  assert.equal((await api('POST', '/api/me/mfa/enable', {token: u.token, body: {code: '000000'}})).status, 400);
  const step = Math.floor(Date.now() / 30000);
  const on = await api('POST', '/api/me/mfa/enable', {token: u.token, body: {code: totpAt(setup.data.secret, step)}});
  assert.equal(on.data.mfa_enabled, true);
  const d = db();
  assert.ok(!String(d.prepare('SELECT totp_secret FROM users WHERE id=?').get(u.id).totp_secret).includes(setup.data.secret), 'secret stored encrypted');
  d.close();
  const first = await login('duas-etapas@exemplo.test', u.password);
  assert.equal(first.data.mfa_required, true);
  assert.equal(first.data.token, undefined, 'no token without the code');
  assert.equal((await api('POST', '/api/login', {body: {email: 'duas-etapas@exemplo.test', password: u.password, code: totpAt(setup.data.secret, step)}})).status, 401, 'same code again is refused');
  const ok = await api('POST', '/api/login', {body: {email: 'duas-etapas@exemplo.test', password: u.password, code: totpAt(setup.data.secret, step + 1)}});
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal((await api('POST', `/api/users/${u.id}/mfa/reset`, {token: tokens.admin})).data.mfa_enabled, false);
  assert.ok((await login('duas-etapas@exemplo.test', u.password)).data.token, 'password only after the reset');
});

// ---------- Anamnesis in ChatGPT: copy and paste, and the MCP plugin with OAuth ----------
const CHATGPT_ANSWER = '## Motivo da avaliação\n\n[PACIENTE] foi trazido pela mãe, que relata sono agitado fictício desde o ano passado, com despertares frequentes descritos apenas por ela.\n\n## Sono\n\nSegundo a mãe, o sono é agitado; o pai, por sua vez, não observa alteração, e essa divergência entre os informantes permanece registrada.';
const opId = () => 'op-' + randomBytes(8).toString('hex');

test('ChatGPT copy and paste: prepared without any AI call, saved once as a draft with titles and names back', async () => {
  const id = await withFiles();
  const calls = aiRequests.length;
  assert.equal((await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.assistant, body: {mode: 'paste'}})).status, 403);
  const t = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste'}});
  assert.equal(t.status, 201);
  assert.equal(t.data.status, 'pending');
  assert.match(t.data.text, /^FAZER TÓPICOS DE ANAMNESE/);
  assert.ok(t.data.text.includes(ANAMNESIS_FACT), 'the notes go with the instruction');
  assert.ok(!t.data.text.includes(PATIENT), 'the patient name is pseudonymised');
  assert.equal(aiRequests.length, calls, 'no API call in the ChatGPT flow');
  const short = await api('POST', `/api/chatgpt-tasks/${t.data.id}/result`, {token: tokens.psy, body: {text: 'Curto.', op_id: opId()}});
  assert.equal(short.status, 409);
  assert.equal((await api('POST', `/api/chatgpt-tasks/${t.data.id}/result`, {token: tokens.admin, body: {text: CHATGPT_ANSWER, op_id: opId()}})).status, 404, 'another account cannot use the task');
  const op = opId();
  const saved = await api('POST', `/api/chatgpt-tasks/${t.data.id}/result`, {token: tokens.psy, body: {text: CHATGPT_ANSWER.replace(/\n/g, '\r\n'), op_id: op}});
  assert.equal(saved.status, 200);
  assert.equal(saved.data.status, 'draft_received');
  assert.equal(saved.data.applied, true);
  assert.deepEqual([saved.data.shape.titles, saved.data.shape.paragraphs], [2, 2]);
  const again = await api('POST', `/api/chatgpt-tasks/${t.data.id}/result`, {token: tokens.psy, body: {text: CHATGPT_ANSWER, op_id: op}});
  assert.equal(again.data.duplicate, true, 'a retry with the same operation is not saved twice');
  assert.equal((await api('POST', `/api/chatgpt-tasks/${t.data.id}/result`, {token: tokens.psy, body: {text: CHATGPT_ANSWER, op_id: opId()}})).status, 409);
  const ev = await api('GET', `/api/evaluations/${id}`, {token: tokens.psy});
  const s = ev.data.sections.find(x => x.section_key === 'anamnesis');
  assert.equal(s.status, 'generated');
  assert.ok(s.content.startsWith('## Motivo da avaliação\n\n' + PATIENT), 'titles kept and the name put back');
  assert.equal(aiRequests.length, calls);
});

test('ChatGPT plugin: OAuth with PKCE, scoped MCP tools, isolation per account and no overwrite without confirmation', async () => {
  const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const resource = base + '/api/mcp';
  const prm = await api('GET', '/.well-known/oauth-protected-resource/api/mcp');
  assert.equal(prm.data.resource, resource);
  const asm = await api('GET', '/.well-known/oauth-authorization-server');
  assert.equal(asm.data.issuer, base);
  const unauth = await api('POST', '/api/mcp', {body: {jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}});
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /resource_metadata=".*oauth-protected-resource\/api\/mcp"/);
  assert.equal((await api('POST', '/api/oauth/register', {body: {redirect_uris: ['https://outro.exemplo.test/cb']}})).status, 400, 'redirects only to ChatGPT');
  const reg = await api('POST', '/api/oauth/register', {body: {client_name: 'ChatGPT', redirect_uris: [redirect], token_endpoint_auth_method: 'none'}});
  assert.equal(reg.status, 201);
  const client = reg.data.client_id;
  const form = o => ({method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(o)});
  const token = o => fetch(base + '/api/oauth/token', form({client_id: client, ...o}));

  /** Authorize (consent by the signed-in account) and return {verifier, back} where back is the redirect to ChatGPT. */
  async function authorize(jwt) {
    const verifier = randomBytes(40).toString('base64url');
    const q = new URLSearchParams({response_type: 'code', client_id: client, redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 'estado-1', scope: 'anamnese.ler anamnese.salvar', resource});
    const a = await fetch(base + '/api/oauth/authorize?' + q, {redirect: 'manual'});
    assert.equal(a.status, 302);
    const rid = new URL(a.headers.get('location')).searchParams.get('autorizar_chatgpt');
    assert.equal((await api('GET', '/api/oauth/requests/' + rid)).status, 401, 'consent needs a NeuroLaudos sign-in');
    assert.equal((await api('GET', '/api/oauth/requests/' + rid, {token: jwt})).data.can_approve, true);
    const d = await api('POST', `/api/oauth/requests/${rid}/decision`, {token: jwt, body: {approve: true}});
    return {verifier, back: new URL(d.data.redirect)};
  }
  const exchange = (back, verifier) => token({grant_type: 'authorization_code', code: back.searchParams.get('code'), redirect_uri: redirect, code_verifier: verifier, resource});
  const mcp = (bearer, method, params) => api('POST', '/api/mcp', {token: bearer, body: {jsonrpc: '2.0', id: 1, method, params}});

  // PKCE, single-use code (a replay revokes what the code issued), iss and state in the redirect
  let {verifier, back} = await authorize(tokens.psy);
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get('state'), 'estado-1');
  assert.equal(back.searchParams.get('iss'), base);
  assert.equal((await exchange(back, verifier + 'x')).status, 400, 'wrong PKCE verifier');
  const first = await (await exchange(back, verifier)).json();
  assert.equal(first.token_type, 'Bearer');
  assert.equal((await exchange(back, verifier)).status, 400, 'a code works once');
  assert.equal((await mcp(first.access_token, 'tools/list', {})).status, 401, 'tokens of a replayed code are revoked');

  ({verifier, back} = await authorize(tokens.psy));
  const tok = await (await exchange(back, verifier)).json();
  assert.equal((await mcp(tok.access_token, 'initialize', {protocolVersion: '2025-11-25'})).data.result.protocolVersion, '2025-11-25');
  assert.equal((await mcp(tok.access_token, 'tools/list', {})).data.result.tools.length, 4);
  // refresh rotates: the old refresh token stops working
  const refreshed = await (await token({grant_type: 'refresh_token', refresh_token: tok.refresh_token})).json();
  assert.ok(refreshed.access_token);
  assert.equal((await token({grant_type: 'refresh_token', refresh_token: tok.refresh_token})).status, 400);
  const access = refreshed.access_token;

  const id = await withFiles();
  const calls = aiRequests.length;
  const task = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'mcp'}});
  assert.equal(task.status, 201);
  assert.ok(task.data.command.includes(task.data.code));
  const call = (name, args, bearer = access) => mcp(bearer, 'tools/call', {name, arguments: args});
  const got = (await call('obter_anamnese_pendente', {codigo: task.data.code.toLowerCase()})).data.result.structuredContent;
  assert.ok(got.dados_da_secao.includes(ANAMNESIS_FACT));
  assert.ok(!JSON.stringify(got).includes(PATIENT), 'no patient name leaves through the plugin');
  assert.match(got.instrucao_de_redacao, /^FAZER TÓPICOS DE ANAMNESE/);
  assert.equal((await call('consultar_status_anamnese', {codigo: task.data.code})).data.result.structuredContent.status, 'processing');

  // another account cannot read or save the psychologist's task
  ({verifier, back} = await authorize(tokens.admin));
  const adminTok = await (await exchange(back, verifier)).json();
  const foreign = (await call('obter_anamnese_pendente', {codigo: task.data.code}, adminTok.access_token)).data.result;
  assert.equal(foreign.isError, true);
  assert.match(foreign.content[0].text, /não encontrada/);
  assert.equal((await call('salvar_rascunho_anamnese', {codigo: task.data.code, texto: CHATGPT_ANSWER, id_operacao: opId()}, adminTok.access_token)).data.result.isError, true);

  const op = opId();
  assert.equal((await call('salvar_rascunho_anamnese', {codigo: task.data.code, texto: CHATGPT_ANSWER, id_operacao: op})).data.result.structuredContent.status, 'draft_received');
  assert.equal((await call('salvar_rascunho_anamnese', {codigo: task.data.code, texto: CHATGPT_ANSWER, id_operacao: op})).data.result.structuredContent.gravacao_repetida, true);
  const anamnesis = async () => (await api('GET', `/api/evaluations/${id}`, {token: tokens.psy})).data.sections.find(x => x.section_key === 'anamnesis').content;
  assert.ok((await anamnesis()).includes(PATIENT));

  // after the psychologist edits, a second plugin draft waits for her confirmation instead of overwriting
  assert.equal((await api('PUT', `/api/evaluations/${id}/sections/anamnesis`, {token: tokens.psy, body: {content: 'Anamnese revisada pela psicóloga, fictícia.'}})).status, 200);
  assert.equal((await call('consultar_status_anamnese', {codigo: task.data.code})).data.result.structuredContent.status, 'reviewed');
  const t2 = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'mcp'}});
  const r2 = (await call('salvar_rascunho_anamnese', {codigo: t2.data.code, texto: CHATGPT_ANSWER, id_operacao: opId()})).data.result.structuredContent;
  assert.match(r2.mensagem, /confirmar a substituição/);
  assert.equal(await anamnesis(), 'Anamnese revisada pela psicóloga, fictícia.', 'existing text untouched');
  const current = (await api('GET', `/api/evaluations/${id}/chatgpt-tasks/current`, {token: tokens.psy})).data;
  assert.equal(current.needs_confirmation, true);
  assert.ok(current.received_text.includes(PATIENT));
  assert.equal((await api('POST', `/api/chatgpt-tasks/${t2.data.id}/apply`, {token: tokens.psy, body: {}})).data.status, 'reviewed');
  assert.ok((await anamnesis()).startsWith('## Motivo'));
  const hist = await api('GET', `/api/evaluations/${id}/sections/anamnesis/history`, {token: tokens.psy});
  assert.ok(JSON.stringify(hist.data).includes('Anamnese revisada pela psicóloga'), 'the replaced text stays in the versions');

  // ChatGPT cannot write safely: it reports the reason instead of saving; the task closes with the reason, nothing is saved
  const t3 = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'mcp'}});
  const rep = (await call('informar_problema', {codigo: t3.data.code, motivo: 'dados_divergentes', detalhe: 'Idade da identificação difere da anamnese (sintético).'})).data.result.structuredContent;
  assert.equal(rep.status, 'error');
  const cur3 = (await api('GET', `/api/evaluations/${id}/chatgpt-tasks/current`, {token: tokens.psy})).data;
  assert.equal(cur3.status, 'error'); assert.equal(cur3.problem, 'dados_divergentes'); assert.match(cur3.error, /Idade/);
  assert.equal((await call('informar_problema', {codigo: t3.data.code, motivo: 'outro', detalhe: 'de novo'})).data.result.isError, true, 'a closed task cannot be reported again');
  assert.ok((await anamnesis()).startsWith('## Motivo'), 'the section text is untouched');

  assert.equal(aiRequests.length, calls, 'no API call in the plugin flow');
  assert.equal((await api('DELETE', '/api/chatgpt/connection', {token: tokens.psy})).status, 200);
  assert.equal((await mcp(access, 'tools/list', {})).status, 401, 'disconnecting revokes the tokens');
  assert.equal((await api('DELETE', `/api/evaluations/${id}`, {token: tokens.psy})).status, 200, 'an evaluation with tasks can still be deleted');
});

test('ChatGPT for any section: only its own tables, conclusion guidance kept, images only on request, never the diagnosis', async () => {
  const id = await withFiles();
  const calls = aiRequests.length;
  const paste = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste', section: 'inteligencia'}});
  assert.equal(paste.status, 201, JSON.stringify(paste.data));
  assert.equal(paste.data.section_key, 'inteligencia');
  assert.ok(paste.data.text.includes('Teste 0'), 'its own table, as text');
  assert.ok(!paste.data.text.includes('Teste 2'), 'no table of another section');
  assert.ok(!paste.data.text.includes('sono agitado'), 'no anamnesis (rule 10)');
  assert.ok(!paste.data.text.includes(PATIENT));
  assert.equal((await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste', section: 'hipotese'}})).status, 409, 'the AI never writes the diagnosis');
  assert.equal((await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste', section: 'outra'}})).status, 400);
  // the anamnesis task of the same evaluation is independent of this one
  const ana = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste'}});
  assert.equal((await api('GET', `/api/evaluations/${id}/chatgpt-tasks/current?section=inteligencia`, {token: tokens.psy})).data.id, paste.data.id);
  assert.equal((await api('GET', `/api/evaluations/${id}/chatgpt-tasks/current`, {token: tokens.psy})).data.id, ana.data.id);
  const text = 'Os resultados obtidos indicam que [PRIMEIRO_NOME] demonstrou recursos para compreender instruções verbais e organizar respostas com apoio, mantendo desempenho consistente ao longo das tarefas propostas na sessão sintética.';
  const saved = await api('POST', `/api/chatgpt-tasks/${paste.data.id}/result`, {token: tokens.psy, body: {text, op_id: 'op-' + randomBytes(8).toString('hex')}});
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const s = (await api('GET', `/api/evaluations/${id}`, {token: tokens.psy})).data.sections.find(x => x.section_key === 'inteligencia');
  assert.ok(s.content.startsWith('Os resultados obtidos indicam que Fulano'), 'first name back');
  // plugin: conclusion guidance travels with the task; images go only when asked (none in this synthetic file)
  const conc = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'mcp', section: 'conclusao', notes: 'Orientação sintética: destacar memória preservada.', include_images: true}});
  assert.equal(conc.status, 201, JSON.stringify(conc.data));
  assert.match(conc.data.command, /seção "Conclusão"/);
  const d = db(); const row = d.prepare('SELECT notes,include_images FROM chatgpt_tasks WHERE id=?').get(conc.data.id); d.close();
  assert.equal(row.notes, 'Orientação sintética: destacar memória preservada.');
  assert.equal(row.include_images, 1);
  // conclusion: a text written by hand counts like an AI one; a section excluded from the document stays out
  await api('PUT', `/api/evaluations/${id}/sections/inteligencia`, {token: tokens.psy, body: {content: 'Texto sintético escrito à mão pela psicóloga sobre raciocínio verbal.'}});
  const concPaste = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste', section: 'conclusao', notes: 'Orientação sintética.'}});
  assert.equal(concPaste.status, 201, JSON.stringify(concPaste.data));
  assert.match(concPaste.data.text, /escrito à mão pela psicóloga/);
  await api('PUT', `/api/evaluations/${id}/excluded-sections`, {token: tokens.psy, body: {key: 'inteligencia'}});
  const concNone = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste', section: 'conclusao', notes: 'Orientação sintética.'}});
  assert.ok(concNone.status === 409 || !concNone.data.text?.includes('escrito à mão'), 'excluded section left out');
  await api('PUT', `/api/evaluations/${id}/excluded-sections`, {token: tokens.psy, body: {key: 'inteligencia', exclude: false}});
  // recommendations: built from the conclusion text only (no other section, table or anamnesis)
  await api('PUT', `/api/evaluations/${id}/sections/conclusao`, {token: tokens.psy, body: {content: 'Conclusão sintética: fragilidade atencional com impacto escolar.'}});
  const rec = await api('POST', `/api/evaluations/${id}/chatgpt-tasks`, {token: tokens.psy, body: {mode: 'paste', section: 'recomendacoes'}});
  assert.equal(rec.status, 201, JSON.stringify(rec.data));
  assert.match(rec.data.text, /fragilidade atencional com impacto escolar/);
  assert.match(rec.data.text, /## Psicoterapia/);
  assert.ok(!rec.data.text.includes('escrito à mão pela psicóloga'), 'no other section text');
  assert.ok(!rec.data.text.includes('sono agitado'), 'no anamnesis');
  assert.equal(aiRequests.length, calls, 'no API call');
});

test('devolutiva schedule: spreadsheet imported once, each new evaluation adds a row, delivery fills the date', async () => {
  const csv = '﻿PACIENTE;IDADE;SUSPEITA DIAGNOSTICA;TESTE A SER APLICADO;INICIO;PRONTOS?;DEVOLUTIVA\r\n' +
    'Paciente Planilha Um;9;;FINALIZADO DIA 10/08/2026;CONVENIO X;;OK DIA 02/09/2026\r\n' +
    'Paciente Planilha Dois;30;FALTA FORMULARIOS;FINALIZADO DIA 20/10/2026;;pronto;\r\n;;;;;;\r\n';
  const send = (token, text = csv) => { const form = new FormData(); form.append('file', new Blob([text]), 'agenda.csv'); return api('POST', '/api/devolutiva-agenda/import', {token, form}); };
  assert.equal((await api('POST', '/api/devolutiva-agenda/import')).status, 401);
  assert.equal((await send(tokens.assistant)).status, 403);
  const first = await send(tokens.psy);
  assert.equal(first.status, 201); assert.equal(first.data.imported, 2); assert.equal(first.data.with_date, 1);
  assert.equal((await send(tokens.psy)).status, 409, 'second import refused');

  const id = await withFiles();
  let list = (await api('GET', '/api/devolutiva-agenda', {token: tokens.assistant})).data;
  assert.equal(list.imported, true);
  const fromSheet = list.rows.filter(r => r.source === 'import');
  assert.equal(fromSheet.length, 2);
  assert.equal(fromSheet[0].status, 'feita'); assert.equal(fromSheet[0].delivery_date, '2026-09-02'); assert.equal(fromSheet[0].age, '9 anos');
  assert.equal(fromSheet[1].status, 'pendente'); assert.equal(fromSheet[1].tests_done_date, '2026-10-20');
  assert.equal(fromSheet[0].readiness, 'Não'); assert.equal(fromSheet[1].readiness, 'Sim');
  let mine = list.rows.find(r => r.evaluation_id === id);
  assert.ok(mine, 'new evaluation has its row'); assert.equal(mine.patient, PATIENT); assert.equal(mine.status, 'pendente');
  assert.equal(mine.readiness, 'Não');
  assert.equal((await api('PUT', `/api/devolutiva-agenda/${mine.id}`, {token: tokens.psy, body: {readiness: 'talvez'}})).status, 400);
  assert.equal((await api('PUT', `/api/devolutiva-agenda/${mine.id}`, {token: tokens.psy, body: {readiness: 'Sim'}})).data.readiness, 'Sim');

  // notes are editable; the date of an evaluation row only comes from the delivery
  const put = await api('PUT', `/api/devolutiva-agenda/${mine.id}`, {token: tokens.psy, body: {notes: 'Falta sessão familiar', delivery_date: '2026-01-01'}});
  assert.equal(put.status, 200); assert.equal(put.data.notes, 'Falta sessão familiar'); assert.equal(put.data.delivery_date, null);
  assert.equal((await api('PUT', `/api/devolutiva-agenda/${mine.id}`, {token: tokens.assistant, body: {notes: 'x'}})).status, 403);
  const sheetPut = await api('PUT', `/api/devolutiva-agenda/${fromSheet[1].id}`, {token: tokens.psy, body: {delivery_date: '2026-11-03'}});
  assert.equal(sheetPut.data.delivery_date, '2026-11-03');

  const ev = `/api/evaluations/${id}`;
  await api('PUT', ev + '/sections/anamnesis', {token: tokens.psy, body: {content: 'Anamnese sintética.'}});
  await api('PUT', ev + '/sections/inteligencia', {token: tokens.psy, body: {content: 'Interpretação sintética.'}});
  await api('PUT', ev + '/sections/conclusao', {token: tokens.psy, body: {content: 'Conclusão sintética.'}});
  assert.equal((await api('POST', ev + '/approve', {token: tokens.psy, body: {approveSections: true}})).status, 200);
  assert.equal((await api('PUT', ev + '/delivery', {token: tokens.psy, body: {date: '2026-11-05', delivered_to: 'Responsável', mode: 'presencial'}})).status, 200);
  list = (await api('GET', '/api/devolutiva-agenda', {token: tokens.psy})).data;
  mine = list.rows.find(r => r.evaluation_id === id);
  assert.equal(mine.delivery_date, '2026-11-05'); assert.equal(mine.status, 'feita');

  assert.equal((await api('DELETE', ev, {token: tokens.psy})).status, 200);
  list = (await api('GET', '/api/devolutiva-agenda', {token: tokens.psy})).data;
  assert.ok(!list.rows.some(r => r.evaluation_id === id), 'row leaves with the evaluation');
});

test('original files can be downloaded exactly as sent (base and anamnesis)', async () => {
  const id = await withFiles();
  for (const [kind, file] of [['base', 'base.docx'], ['anamnesis', 'anamnese.docx']]) {
    const r = await api('POST', `/api/evaluations/${id}/documents/${kind}/original`, {token: tokens.psy, body: {}});
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    assert.ok(Buffer.compare(r.data, fs.readFileSync(path.join(tmp, file))) === 0, kind + ': same bytes as uploaded');
  }
  assert.equal((await api('POST', `/api/evaluations/${id}/documents/outro/original`, {token: tokens.psy, body: {}})).status, 400);
});

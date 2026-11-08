// Anamnesis written in ChatGPT, as an alternative to the API generation (which is unchanged):
//  - MCP plugin: ChatGPT reads the pending task and saves the draft through OAuth-protected tools (off by default:
//    CHATGPT_MCP_ENABLED=true and an HTTPS PUBLIC_BASE_URL).
//  - Assisted copy and paste: the system prepares the text, the person pastes it in ChatGPT and pastes the answer back.
// No OpenAI API call happens in either flow, nothing reads the ChatGPT page, and the original files are never touched.
// Clinical text never goes to logs; audit rows hold only the action.
import express from 'express';
import rateLimit from 'express-rate-limit';
import {randomUUID} from 'node:crypto';
import {CHATGPT_ANAMNESIS_INSTRUCTION, CHATGPT_ANAMNESIS_FORMAT, chatgptCommand} from './prompts.mjs';
import {TASK_MODES, TASK_STATUS, OPEN_STATUSES, newTaskCode, normalizeCode, validOpId, normalizeAnswer, answerProblems, answerShape, pastePackage, taskStatus} from './chatgpt.mjs';
import {SCOPES, ACCESS_TTL_S, REFRESH_TTL_S, CODE_TTL_S, REQUEST_TTL_S, newSecret, hashSecret, pkceOk, publicBase, mcpResource, protectedResourceMetadata, authServerMetadata, challenge, redirectHosts, validRedirect, grantedScopes, redirectWith} from './oauth.mjs';
import {handleMessage, ToolError} from './mcp.mjs';
import {metalanguageTerms} from './wording.mjs';
import {leftoverPlaceholders} from './privacy.mjs';

const KEY = 'anamnesis';
const FROM_FILE = 'from_file';
const later = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const past = iso => !iso || Date.parse(iso) <= Date.now();

export function chatgptConfig(env = process.env) {
  const base = publicBase(env.PUBLIC_BASE_URL);
  const wanted = env.CHATGPT_MCP_ENABLED === 'true';
  return {
    taskHours: Math.min(Math.max(Number(env.CHATGPT_TASK_HOURS) || 24, 1), 168),
    keepDays: Math.min(Math.max(Number(env.CHATGPT_KEEP_DAYS) || 7, 1), 90),
    mcp: wanted && !!base, base, mcpProblem: wanted && !base ? 'PUBLIC_BASE_URL precisa ser um endereço https (ex.: https://neurolaudos.exemplo.com.br).' : null,
    redirectHosts: redirectHosts(env.CHATGPT_OAUTH_REDIRECT_HOSTS),
  };
}

/**
 * deps: pool, auth, role, wrap, fail, audit(req,action,evaluationId), evaluation(id), requireAiMode(e, req),
 * anamnesisForChatGpt(e) -> {notes, genderRule, hidden}  (pseudonymised text of the anamnesis DOCX),
 * restoreFor(e) -> async text => text with the placeholders put back, version.
 */
export function mountChatGpt(app, deps, cfg = chatgptConfig()) {
  const {pool, auth, role, wrap, fail, audit, evaluation, requireAiMode} = deps;
  const writer = role('admin', 'psychologist');

  // ---------- tasks ----------
  async function taskByCode(code) { const c = normalizeCode(code); if (!c) return null; const [[t]] = await pool.execute('SELECT * FROM chatgpt_tasks WHERE code=?', [c]); return t || null; }
  async function taskById(id) { const [[t]] = await pool.execute('SELECT * FROM chatgpt_tasks WHERE id=?', [String(id)]); return t || null; }
  const sectionOf = async evaluationId => { const [[s]] = await pool.execute('SELECT id,content,status,version,source_summary,approved_at FROM sections WHERE evaluation_id=? AND section_key=?', [evaluationId, KEY]); return s || null; };
  /** An untouched copy of the anamnesis file (manual-mode prefill) or nothing at all: a draft can go straight in. */
  const replaceable = s => !s || !String(s.content || '').trim() || (s.source_summary === FROM_FILE && Number(s.version) === 1 && s.status !== 'approved');

  async function view(t) {
    const s = await sectionOf(t.evaluation_id);
    const status = taskStatus(t, s);
    return {
      id: t.id, code: t.code, mode: t.mode, status, status_label: TASK_STATUS[status], expires_at: t.expires_at, created_at: t.created_at,
      fetched_at: t.fetched_at, received_at: t.received_at, received_via: t.received_via, applied: !!t.applied_at,
      needs_confirmation: t.status === 'draft_received' && !t.applied_at, received_text: t.status === 'draft_received' && !t.applied_at ? t.received_text : null,
      existing_approved: s?.status === 'approved', error: t.error,
      ...(t.mode === 'mcp' ? {command: chatgptCommand(t.code)} : {}),
    };
  }
  /** Same answer whether the task does not exist or belongs to someone else: codes cannot be probed. */
  function ownTask(t, user) { if (!t || t.created_by !== user.id) throw new ToolError('Tarefa não encontrada para esta conta. Confira o código no NeuroLaudos IA.'); return t; }
  function usable(t) {
    if (taskStatus(t, null) === 'expired') throw new ToolError('Esta tarefa expirou. Prepare uma nova no NeuroLaudos IA.');
    if (['expired', 'discarded', 'error'].includes(t.status)) throw new ToolError('Esta tarefa não está mais ativa. Prepare uma nova no NeuroLaudos IA.');
  }
  async function openEvaluation(t) {
    const e = await evaluation(t.evaluation_id);
    if (e.status === 'approved') throw new ToolError('A avaliação já foi aprovada e está travada. Nada foi salvo.');
    // The mode was checked when the task was created (manual evaluations only by the person's explicit choice).
    return e;
  }

  /** Writes the draft into the Anamnese as AI text to review (the previous text goes to the version history). */
  async function writeSection(e, text, warnings, actorId) {
    const prev = await sectionOf(e.id);
    if (prev) {
      await pool.execute('INSERT INTO section_history(section_id,version,content,actor_id) VALUES(?,?,?,?)', [prev.id, prev.version, prev.content, actorId]);
      await pool.execute("UPDATE sections SET content=?,content_html=NULL,source_summary=?,ai_text=?,status='generated',approved_by=NULL,approved_at=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?", [text, JSON.stringify(warnings), text, prev.id]);
    } else {
      await pool.execute('INSERT INTO sections(id,evaluation_id,section_key,title,content,source_summary,ai_text) VALUES(?,?,?,?,?,?,?)', [randomUUID(), e.id, KEY, KEY, text, JSON.stringify(warnings), text]);
    }
    await pool.execute("UPDATE evaluations SET status='review' WHERE id=? AND status<>'approved'", [e.id]);
    return Number((await sectionOf(e.id)).version);
  }
  const warningsOf = text => {
    const out = [];
    const left = leftoverPlaceholders(text); if (left.length) out.push('Marcadores não reconhecidos no texto: ' + left.join(', ') + '. Troque pelo dado correto antes de aprovar.');
    const m = metalanguageTerms(text); if (m.length) out.push('Texto com expressões de transcrição (' + m.join(', ') + '). Reescreva esses trechos antes de aprovar.');
    return out;
  };

  /**
   * Saves an answer once per task. A retry with the same op id returns the first result; another op id is refused.
   * An existing anamnesis (edited, generated or approved) is never overwritten here: the draft waits for confirmation.
   */
  async function saveAnswer(req, t, rawText, opId, via) {
    if (!validOpId(opId)) throw new ToolError('id_operacao inválido: use de 8 a 100 letras, números, ponto, hífen ou dois-pontos.');
    if (t.op_id) {
      if (t.op_id === opId) return {...await view(t), duplicate: true};
      throw new ToolError('Esta tarefa já recebeu um rascunho. Para mandar outro texto, prepare uma nova tarefa no NeuroLaudos IA.');
    }
    usable(t);
    let e;
    try { e = await openEvaluation(t); }
    catch (err) { if (err instanceof ToolError) await pool.execute("UPDATE chatgpt_tasks SET status='error',error=? WHERE id=? AND op_id IS NULL", [err.message, t.id]); throw err; }
    const normalized = normalizeAnswer(rawText);
    const problems = answerProblems(normalized);
    if (problems.length) throw new ToolError(problems.join(' '));
    const text = await deps.restoreFor(e)(normalized);
    // Claims the task atomically, so two concurrent saves cannot both land.
    const [claim] = await pool.execute(`UPDATE chatgpt_tasks SET status='draft_received',op_id=?,received_at=CURRENT_TIMESTAMP,received_via=?,received_text=? WHERE id=? AND op_id IS NULL AND status IN ('pending','processing')`, [opId, via, text, t.id]);
    if (!claim.affectedRows) { const again = await taskById(t.id); if (again?.op_id === opId) return {...await view(again), duplicate: true}; throw new ToolError('Esta tarefa já recebeu um rascunho.'); }
    await audit(req, 'chatgpt_draft_received_' + via, e.id);
    const s = await sectionOf(e.id);
    if (replaceable(s)) {
      const version = await writeSection(e, text, warningsOf(text), req.user.id);
      await pool.execute('UPDATE chatgpt_tasks SET applied_at=CURRENT_TIMESTAMP,applied_by=?,applied_version=?,received_text=NULL WHERE id=?', [req.user.id, version, t.id]);
      await audit(req, 'chatgpt_draft_applied', e.id);
    }
    return {...await view(await taskById(t.id)), shape: answerShape(text)};
  }

  async function createTask(req, e, mode) {
    // Any open task of this person for this evaluation stops working: one current task at a time.
    await pool.execute(`UPDATE chatgpt_tasks SET status='expired' WHERE evaluation_id=? AND created_by=? AND status IN ('pending','processing')`, [e.id, req.user.id]);
    let code; for (let i = 0; i < 5 && !code; i++) { const c = newTaskCode(); if (!await taskByCode(c)) code = c; }
    if (!code) throw fail(503, 'Não foi possível criar o código da tarefa. Tente de novo.');
    const id = randomUUID();
    await pool.execute('INSERT INTO chatgpt_tasks(id,code,evaluation_id,section_key,mode,created_by,expires_at) VALUES(?,?,?,?,?,?,?)', [id, code, e.id, KEY, mode, req.user.id, later(cfg.taskHours * 3600)]);
    await audit(req, 'chatgpt_task_created_' + mode, e.id);
    return taskById(id);
  }
  async function needsAnamnesis(e) { const [[d]] = await pool.execute("SELECT COUNT(*) n FROM documents WHERE evaluation_id=? AND kind='anamnesis'", [e.id]); if (!Number(d.n)) throw fail(409, 'Envie o arquivo de anamnese antes de usar o ChatGPT.'); }

  // ---------- routes for the NeuroLaudos screen (JWT) ----------
  app.get('/api/chatgpt/config', auth, wrap(async (req, res) => {
    let connected = false;
    if (cfg.mcp) { const [[c]] = await pool.execute("SELECT COUNT(*) n FROM oauth_tokens WHERE user_id=? AND kind='refresh' AND revoked_at IS NULL AND expires_at>?", [req.user.id, new Date().toISOString()]); connected = Number(c.n) > 0; }
    res.json({mcp_enabled: cfg.mcp, mcp_url: cfg.mcp ? mcpResource(cfg.base) : null, mcp_problem: cfg.mcpProblem, connected, task_hours: cfg.taskHours, modes: TASK_MODES});
  }));
  app.post('/api/evaluations/:id/chatgpt-tasks', auth, writer, wrap(async (req, res) => {
    const e = await evaluation(req.params.id);
    if (e.status === 'approved') throw fail(409, 'Avaliação aprovada: travada');
    requireAiMode(e, req);
    const mode = String(req.body?.mode || '');
    if (!TASK_MODES.includes(mode)) throw fail(400, 'Método inválido');
    if (mode === 'mcp' && !cfg.mcp) throw fail(409, 'A integração com o plugin do ChatGPT está desligada neste computador. Use a cópia e colagem assistida.');
    await needsAnamnesis(e);
    // Paste mode: the text is assembled now and handed to the screen only (never stored, never logged).
    let text = null, hidden = 0;
    if (mode === 'paste') { const a = await deps.anamnesisForChatGpt(e); hidden = a.hidden; text = pastePackage({instruction: CHATGPT_ANAMNESIS_INSTRUCTION, genderRule: a.genderRule, format: CHATGPT_ANAMNESIS_FORMAT, notes: a.notes}); }
    const t = await createTask(req, e, mode);
    res.status(201).json({...await view(t), text, hidden});
  }));
  app.get('/api/evaluations/:id/chatgpt-tasks/current', auth, wrap(async (req, res) => {
    const e = await evaluation(req.params.id);
    const [[t]] = await pool.execute("SELECT * FROM chatgpt_tasks WHERE evaluation_id=? AND created_by=? AND status<>'discarded' ORDER BY created_at DESC, rowid DESC LIMIT 1", [e.id, req.user.id]);
    res.json(t ? await view(t) : null);
  }));
  const screenTask = async req => { const t = await taskById(req.params.task); if (!t || t.created_by !== req.user.id) throw fail(404, 'Tarefa não encontrada'); return t; };
  const asHttp = async f => { try { return await f(); } catch (err) { if (err instanceof ToolError) throw fail(409, err.message); throw err; } };
  // Copy and paste: the answer the person pasted from ChatGPT.
  app.post('/api/chatgpt-tasks/:task/result', auth, writer, wrap(async (req, res) => {
    const t = await screenTask(req);
    res.json(await asHttp(() => saveAnswer(req, t, req.body?.text, req.body?.op_id, 'paste')));
  }));
  // The psychologist confirms that the received draft replaces the current Anamnese (kept in the version history).
  app.post('/api/chatgpt-tasks/:task/apply', auth, writer, wrap(async (req, res) => {
    const t = await screenTask(req);
    if (t.status !== 'draft_received' || t.applied_at || !t.received_text) throw fail(409, 'Não há rascunho aguardando confirmação nesta tarefa.');
    const e = await asHttp(() => openEvaluation(t));
    const version = await writeSection(e, t.received_text, warningsOf(t.received_text), req.user.id);
    await pool.execute("UPDATE chatgpt_tasks SET status='reviewed',applied_at=CURRENT_TIMESTAMP,applied_by=?,applied_version=?,received_text=NULL WHERE id=?", [req.user.id, version, t.id]);
    await audit(req, 'chatgpt_draft_applied', e.id);
    res.json(await view(await taskById(t.id)));
  }));
  app.post('/api/chatgpt-tasks/:task/discard', auth, writer, wrap(async (req, res) => {
    const t = await screenTask(req);
    await pool.execute("UPDATE chatgpt_tasks SET status='discarded',received_text=NULL WHERE id=?", [t.id]);
    await audit(req, 'chatgpt_task_discarded', t.evaluation_id);
    res.json({ok: true});
  }));
  // Ends every ChatGPT connection of this account (tokens revoked; ChatGPT has to ask for authorization again).
  app.delete('/api/chatgpt/connection', auth, wrap(async (req, res) => {
    await pool.execute('UPDATE oauth_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL', [req.user.id]);
    await audit(req, 'chatgpt_disconnected');
    res.json({ok: true});
  }));

  // ---------- MCP + OAuth (only when enabled) ----------
  if (cfg.mcp) mountMcp();
  function mountMcp() {
    const base = cfg.base, resource = mcpResource(base);
    const oauthLimiter = rateLimit({windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false});
    const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); next(); };
    const prm = (req, res) => res.json(protectedResourceMetadata(base));
    const asm = (req, res) => res.json(authServerMetadata(base));
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp', '/api/.well-known/oauth-protected-resource']) app.get(p, prm);
    for (const p of ['/.well-known/oauth-authorization-server', '/api/.well-known/oauth-authorization-server']) app.get(p, asm);

    // RFC 7591: public clients (no secret), redirect only to ChatGPT.
    app.post('/api/oauth/register', oauthLimiter, noStore, wrap(async (req, res) => {
      const uris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String) : [];
      if (!uris.length || uris.length > 5 || !uris.every(u => validRedirect(u, cfg.redirectHosts))) return res.status(400).json({error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https on an allowed host'});
      const method = req.body?.token_endpoint_auth_method || 'none';
      if (method !== 'none') return res.status(400).json({error: 'invalid_client_metadata', error_description: 'only token_endpoint_auth_method=none is supported'});
      const clientId = 'nl-' + newSecret(18);
      const name = String(req.body?.client_name || 'ChatGPT').slice(0, 100);
      await pool.execute('INSERT INTO oauth_clients(client_id,client_name,redirect_uris_json) VALUES(?,?,?)', [clientId, name, JSON.stringify(uris)]);
      res.status(201).json({client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none'});
    }));
    const clientOf = async id => { const [[c]] = await pool.execute('SELECT * FROM oauth_clients WHERE client_id=?', [String(id || '')]); return c ? {...c, redirect_uris: JSON.parse(c.redirect_uris_json)} : null; };

    // Authorization: validated here, then the person signs in to NeuroLaudos (with its own password and 2-step code)
    // and approves on the consent screen. Only a random request id goes in the URL.
    app.get('/api/oauth/authorize', oauthLimiter, noStore, wrap(async (req, res) => {
      const q = req.query;
      const client = await clientOf(q.client_id);
      const redirect = String(q.redirect_uri || '');
      if (!client || !client.redirect_uris.includes(redirect)) return res.status(400).type('text/plain').send('Pedido de autorização inválido (cliente ou endereço de retorno desconhecido).');
      const back = (error, description) => res.redirect(302, redirectWith(redirect, {error, error_description: description, state: q.state}, base));
      if (q.response_type !== 'code') return back('unsupported_response_type');
      if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(String(q.code_challenge || ''))) return back('invalid_request', 'PKCE S256 required');
      if (q.resource && String(q.resource) !== resource) return back('invalid_target', 'unknown resource');
      const scope = grantedScopes(q.scope);
      if (!scope) return back('invalid_scope');
      const id = newSecret(24);
      await pool.execute('INSERT INTO oauth_requests(id,client_id,redirect_uri,state,code_challenge,scope,resource,expires_at) VALUES(?,?,?,?,?,?,?,?)', [hashSecret(id), client.client_id, redirect, q.state ? String(q.state).slice(0, 500) : null, String(q.code_challenge), scope, resource, later(REQUEST_TTL_S)]);
      res.redirect(302, base + '/?autorizar_chatgpt=' + encodeURIComponent(id));
    }));
    const pendingRequest = async id => { const [[r]] = await pool.execute('SELECT * FROM oauth_requests WHERE id=?', [hashSecret(id)]); if (!r || past(r.expires_at)) throw fail(404, 'Pedido de autorização expirado. Volte ao ChatGPT e conecte de novo.'); return r; };
    app.get('/api/oauth/requests/:rid', auth, wrap(async (req, res) => {
      const r = await pendingRequest(req.params.rid); const c = await clientOf(r.client_id);
      res.json({client_name: c?.client_name || 'ChatGPT', scopes: r.scope.split(' '), expires_at: r.expires_at, can_approve: ['admin', 'psychologist'].includes(req.user.role)});
    }));
    app.post('/api/oauth/requests/:rid/decision', auth, noStore, wrap(async (req, res) => {
      const r = await pendingRequest(req.params.rid);
      await pool.execute('DELETE FROM oauth_requests WHERE id=?', [r.id]);
      if (req.body?.approve !== true || !['admin', 'psychologist'].includes(req.user.role)) {
        await audit(req, 'chatgpt_authorization_denied');
        return res.json({redirect: redirectWith(r.redirect_uri, {error: 'access_denied', state: r.state}, base)});
      }
      const code = newSecret(32);
      await pool.execute('INSERT INTO oauth_codes(code_hash,client_id,user_id,redirect_uri,code_challenge,scope,resource,expires_at) VALUES(?,?,?,?,?,?,?,?)', [hashSecret(code), r.client_id, req.user.id, r.redirect_uri, r.code_challenge, r.scope, r.resource, later(CODE_TTL_S)]);
      await audit(req, 'chatgpt_authorized');
      res.json({redirect: redirectWith(r.redirect_uri, {code, state: r.state}, base)});
    }));

    async function issueTokens(user, clientId, scope) {
      const access = newSecret(32), refresh = newSecret(32);
      for (const [kind, value, ttl] of [['access', access, ACCESS_TTL_S], ['refresh', refresh, REFRESH_TTL_S]])
        await pool.execute('INSERT INTO oauth_tokens(token_hash,kind,client_id,user_id,scope,resource,token_version,expires_at) VALUES(?,?,?,?,?,?,?,?)', [hashSecret(value), kind, clientId, user.id, scope, resource, Number(user.token_version || 0), later(ttl)]);
      return {access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope};
    }
    const activeUser = async id => { const [[u]] = await pool.execute('SELECT id,role,active,token_version FROM users WHERE id=?', [id]); return u && u.active && ['admin', 'psychologist'].includes(u.role) ? u : null; };
    const tokenError = (res, error, description) => res.status(400).json({error, ...(description ? {error_description: description} : {})});
    app.post('/api/oauth/token', oauthLimiter, express.urlencoded({extended: false, limit: '20kb'}), noStore, wrap(async (req, res) => {
      const b = req.body || {};
      const client = await clientOf(b.client_id);
      if (!client) return res.status(401).json({error: 'invalid_client'});
      if (b.resource && String(b.resource) !== resource) return tokenError(res, 'invalid_target');
      if (b.grant_type === 'authorization_code') {
        const [[c]] = await pool.execute('SELECT * FROM oauth_codes WHERE code_hash=?', [hashSecret(b.code || '')]);
        if (!c || c.client_id !== client.client_id || c.redirect_uri !== String(b.redirect_uri || '') || past(c.expires_at)) return tokenError(res, 'invalid_grant');
        if (!c.used_at && !pkceOk(b.code_verifier, c.code_challenge)) return tokenError(res, 'invalid_grant', 'PKCE verification failed');
        // Single use: a replayed code also revokes what the first use issued (RFC 6749 §10.5).
        const [used] = await pool.execute('UPDATE oauth_codes SET used_at=CURRENT_TIMESTAMP WHERE code_hash=? AND used_at IS NULL', [c.code_hash]);
        if (!used.affectedRows) { await pool.execute('UPDATE oauth_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND client_id=? AND revoked_at IS NULL', [c.user_id, c.client_id]); return tokenError(res, 'invalid_grant'); }
        const u = await activeUser(c.user_id); if (!u) return tokenError(res, 'invalid_grant');
        return res.json(await issueTokens(u, client.client_id, c.scope));
      }
      if (b.grant_type === 'refresh_token') {
        const [[t]] = await pool.execute("SELECT * FROM oauth_tokens WHERE token_hash=? AND kind='refresh'", [hashSecret(b.refresh_token || '')]);
        if (!t || t.client_id !== client.client_id || t.revoked_at || past(t.expires_at)) return tokenError(res, 'invalid_grant');
        const u = await activeUser(t.user_id); if (!u || Number(u.token_version || 0) !== Number(t.token_version)) return tokenError(res, 'invalid_grant');
        await pool.execute('UPDATE oauth_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?', [t.token_hash]);
        return res.json(await issueTokens(u, client.client_id, b.scope ? grantedScopes(b.scope).split(' ').filter(s => t.scope.split(' ').includes(s)).join(' ') || t.scope : t.scope));
      }
      return tokenError(res, 'unsupported_grant_type');
    }));
    app.post('/api/oauth/revoke', oauthLimiter, express.urlencoded({extended: false, limit: '20kb'}), wrap(async (req, res) => {
      await pool.execute('UPDATE oauth_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND revoked_at IS NULL', [hashSecret(req.body?.token || '')]);
      res.status(200).json({});
    }));

    // Every MCP request carries a valid access token for this resource, of an active psychologist or admin whose
    // password was not changed since (token_version).
    async function bearer(req, res, next) {
      const deny = (error) => res.status(401).set('WWW-Authenticate', challenge(base, SCOPES.read + ' ' + SCOPES.write, error)).json({error: error || 'unauthorized'});
      try {
        const token = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1];
        if (!token) return deny();
        const [[t]] = await pool.execute("SELECT * FROM oauth_tokens WHERE token_hash=? AND kind='access'", [hashSecret(token)]);
        if (!t || t.revoked_at || past(t.expires_at) || t.resource !== resource) return deny('invalid_token');
        const [[u]] = await pool.execute('SELECT id,email,name,role,active,token_version FROM users WHERE id=?', [t.user_id]);
        if (!u || !u.active || !['admin', 'psychologist'].includes(u.role) || Number(u.token_version || 0) !== Number(t.token_version)) return deny('invalid_token');
        req.user = {id: u.id, role: u.role, email: u.email, name: u.name}; req.scopes = t.scope.split(' ');
        next();
      } catch (err) { next(err); }
    }

    async function callTool(req, name, args) {
      const t = ownTask(await taskByCode(args.codigo), req.user);
      if (t.mode !== 'mcp') throw new ToolError('Esta tarefa foi preparada para cópia e colagem, não para o plugin. Prepare uma tarefa do tipo plugin no NeuroLaudos IA.');
      if (name === 'consultar_status_anamnese') {
        const v = await view(t);
        return {codigo: v.code, status: v.status, status_texto: v.status_label, rascunho_aplicado: v.applied, aguardando_confirmacao_da_psicologa: v.needs_confirmation, expira_em: v.expires_at};
      }
      if (name === 'obter_anamnese_pendente') {
        usable(t);
        if (t.status === 'draft_received') throw new ToolError('Esta tarefa já recebeu um rascunho. Para refazer, prepare uma nova tarefa no NeuroLaudos IA.');
        const e = await openEvaluation(t);
        const a = await deps.anamnesisForChatGpt(e);
        await pool.execute("UPDATE chatgpt_tasks SET status='processing',fetched_at=COALESCE(fetched_at,CURRENT_TIMESTAMP) WHERE id=? AND status IN ('pending','processing')", [t.id]);
        await audit(req, 'chatgpt_task_fetched', e.id);
        return {
          codigo: t.code, secao: 'Anamnese', instrucao_de_redacao: CHATGPT_ANAMNESIS_INSTRUCTION, regra_de_sexo: a.genderRule, formato: CHATGPT_ANAMNESIS_FORMAT,
          anotacoes_da_anamnese: a.notes, dados_pessoais_trocados_por_marcadores: a.hidden, expira_em: t.expires_at,
          proximo_passo: 'Redija a anamnese completa e chame salvar_rascunho_anamnese com este código, o texto final e um id_operacao novo.',
        };
      }
      if (name === 'salvar_rascunho_anamnese') {
        const r = await saveAnswer(req, t, args.texto, args.id_operacao, 'mcp');
        return {
          codigo: r.code, status: r.status, status_texto: r.status_label, gravacao_repetida: !!r.duplicate,
          mensagem: r.needs_confirmation ? 'Rascunho recebido. A avaliação já tem uma anamnese; a psicóloga precisa confirmar a substituição no NeuroLaudos IA.' : 'Rascunho salvo na Anamnese do NeuroLaudos IA para revisão e aprovação da psicóloga.',
        };
      }
      throw new ToolError('Ferramenta desconhecida');
    }

    app.post('/api/mcp', bearer, wrap(async (req, res) => {
      const ctx = {scopes: req.scopes, version: deps.version, callTool: (name, args) => callTool(req, name, args)};
      const body = req.body;
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map(m => handleMessage(m, ctx)))).filter(Boolean);
        return out.length ? res.json(out) : res.status(202).end();
      }
      const out = await handleMessage(body, ctx);
      return out ? res.json(out) : res.status(202).end();
    }));
    app.all('/api/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({error: 'method_not_allowed'}));
  }

  // ---------- retention: nothing temporary is kept indefinitely ----------
  async function sweep() {
    const now = new Date().toISOString(), old = new Date(Date.now() - cfg.keepDays * 864e5).toISOString();
    await pool.execute("UPDATE chatgpt_tasks SET status='expired' WHERE status IN ('pending','processing') AND expires_at<=?", [now]);
    // A received draft waiting for confirmation is kept keepDays after the task expiry, then only the status remains.
    await pool.execute('UPDATE chatgpt_tasks SET received_text=NULL WHERE received_text IS NOT NULL AND expires_at<=?', [old]);
    await pool.execute('DELETE FROM oauth_requests WHERE expires_at<=?', [now]);
    await pool.execute('DELETE FROM oauth_codes WHERE expires_at<=?', [now]);
    await pool.execute('DELETE FROM oauth_tokens WHERE expires_at<=? OR (revoked_at IS NOT NULL AND revoked_at<=?)', [now, old]);
  }
  return {sweep, config: cfg};
}

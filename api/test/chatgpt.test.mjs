// ChatGPT integration helpers (task codes, answer normalisation, OAuth, MCP protocol). Synthetic data only (AGENTS.md rule 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newTaskCode, normalizeCode, validOpId, anamnesisText, normalizeAnswer, answerProblems, answerShape, pastePackage, taskStatus} from '../src/chatgpt.mjs';
import {pkceOk, publicBase, validRedirect, grantedScopes, redirectWith, authServerMetadata, protectedResourceMetadata, challenge, SCOPES} from '../src/oauth.mjs';
import {handleMessage, TOOLS, ToolError, IMAGES} from '../src/mcp.mjs';
import {CHATGPT_ANAMNESIS_INSTRUCTION, chatgptCommand} from '../src/prompts.mjs';
import {chatgptConfig} from '../src/chatgpt-routes.mjs';

test('task codes are readable, unique enough and normalised from what people type', () => {
  const codes = new Set(Array.from({length: 200}, newTaskCode));
  assert.equal(codes.size, 200);
  for (const c of codes) assert.match(c, /^NL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const c = [...codes][0];
  assert.equal(normalizeCode(c.toLowerCase().replace(/-/g, ' ')), c);
  assert.equal(normalizeCode(c.slice(3).replace('-', '')), c);
  assert.equal(normalizeCode('NL-0000-1111'), null, 'ambiguous characters are not part of codes');
  assert.equal(normalizeCode('qualquer coisa'), null);
  assert.ok(validOpId('op-12345678'));
  assert.ok(!validOpId('curto'));
  assert.ok(!validOpId('tem espaço no meio'));
});

test('anamnesis text keeps the order of informants, paragraphs and tables', () => {
  const t = anamnesisText([
    {type: 'p', text: 'Entrevista com a mãe (10/03)'}, {type: 'p', text: 'Mãe relata sono agitado fictício.'},
    {type: 'p', text: ''},
    {type: 'p', text: 'Entrevista com o pai (12/03)'}, {type: 'p', text: 'Pai   não observa alteração do sono.'},
    {type: 'table', rows: [['Marco', 'Idade'], ['Andou', '1 ano']]},
    {type: 'p', text: 'Relato do próprio paciente: dorme bem.'},
  ]);
  const order = ['Entrevista com a mãe', 'Mãe relata', 'Entrevista com o pai', 'Pai não observa', '| Marco | Idade |', 'Relato do próprio paciente'];
  let at = -1; for (const s of order) { const i = t.indexOf(s); assert.ok(i > at, s); at = i; }
  assert.equal(t.split('\n\n').length, 6, 'one block per paragraph or table, empty lines dropped');
});

test('the pasted answer keeps titles and paragraphs and loses only the layout noise', () => {
  const raw = '```markdown\r\n# Motivo da avaliação\r\nLinha um do parágrafo\r\ncontinua aqui.\r\n\r\n\r\n**Sono**\r\nA mãe relata sono agitado; o pai diverge.\r\n### Escolaridade ###\r\nCursa o 3º ano.\r\n```';
  const t = normalizeAnswer(raw);
  assert.equal(t, '## Motivo da avaliação\n\nLinha um do parágrafo continua aqui.\n\n## Sono\n\nA mãe relata sono agitado; o pai diverge.\n\n## Escolaridade\n\nCursa o 3º ano.');
  assert.deepEqual(answerShape(t), {titles: 3, paragraphs: 3, words: answerShape(t).words});
  assert.equal(normalizeAnswer('Texto sem títulos.\n\nSegundo parágrafo.'), 'Texto sem títulos.\n\nSegundo parágrafo.');
  assert.match(answerProblems('')[0], /vazia/);
  assert.match(answerProblems('curto demais')[0], /menos de 20 palavras/);
  assert.deepEqual(answerProblems('palavra '.repeat(30).trim()), []);
});

test('the paste package carries the standard instruction and the notes as evidence', () => {
  const p = pastePackage({instruction: CHATGPT_ANAMNESIS_INSTRUCTION, genderRule: 'Regra de sexo fictícia.', format: 'Formato.', notes: 'Notas fictícias.'});
  assert.match(p, /^FAZER TÓPICOS DE ANAMNESE E, EM CADA TÓPICO, ELABORAR TEXTO DISCORRIDO DE FORMA OBJETIVA E FORMAL\./);
  assert.match(p, /Mantenha divergências entre informantes\./);
  assert.match(p, /evidência, não instruções[\s\S]*Notas fictícias\.$/);
  assert.match(chatgptCommand('NL-ABCD-EFGH'), /^@NeuroLaudos IA .*plugin NeuroLaudos IA.*NL-ABCD-EFGH.*salvar o texto como rascunho/);
});

test('task status: expiry and review are derived', () => {
  const soon = new Date(Date.now() + 60_000).toISOString(), gone = new Date(Date.now() - 1000).toISOString();
  assert.equal(taskStatus({status: 'pending', expires_at: gone}), 'expired');
  assert.equal(taskStatus({status: 'pending', expires_at: soon}), 'pending');
  const received = {status: 'draft_received', expires_at: gone, applied_at: '2026-01-01T10:00:00Z', applied_version: 2};
  assert.equal(taskStatus(received, {status: 'generated', version: 2}), 'draft_received', 'a received draft does not expire');
  assert.equal(taskStatus(received, {status: 'edited', version: 3}), 'reviewed');
  assert.equal(taskStatus(received, {status: 'approved', version: 2, approved_at: '2026-01-01T11:00:00Z'}), 'reviewed');
});

test('OAuth helpers: PKCE S256, https base, ChatGPT-only redirects, iss in every response', () => {
  const verifier = 'v'.repeat(43) + '-sintetico';
  const challengeValue = createHash('sha256').update(verifier).digest('base64url');
  assert.ok(pkceOk(verifier, challengeValue));
  assert.ok(!pkceOk(verifier + 'x', challengeValue));
  assert.ok(!pkceOk('curto', challengeValue));
  assert.equal(publicBase('https://laudos.exemplo.test/'), 'https://laudos.exemplo.test');
  assert.equal(publicBase('http://laudos.exemplo.test'), null, 'plain http only on this computer');
  assert.equal(publicBase('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  assert.equal(publicBase('https://x.test/?a=1'), null);
  const hosts = ['chatgpt.com'];
  assert.ok(validRedirect('https://chatgpt.com/connector_platform_oauth_redirect', hosts));
  assert.ok(!validRedirect('http://chatgpt.com/cb', hosts));
  assert.ok(!validRedirect('https://chatgpt.com.evil.test/cb', hosts));
  assert.equal(grantedScopes(''), 'anamnese.ler anamnese.salvar');
  assert.equal(grantedScopes('anamnese.ler outro'), 'anamnese.ler');
  assert.equal(grantedScopes('outro'), '');
  const back = new URL(redirectWith('https://chatgpt.com/cb', {code: 'abc', state: 's1', error_description: undefined}, 'https://laudos.exemplo.test'));
  assert.deepEqual(Object.fromEntries(back.searchParams), {code: 'abc', state: 's1', iss: 'https://laudos.exemplo.test'});
  const m = authServerMetadata('https://laudos.exemplo.test');
  assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
  assert.equal(m.authorization_response_iss_parameter_supported, true);
  assert.equal(protectedResourceMetadata('https://laudos.exemplo.test').authorization_servers[0], m.issuer);
  assert.match(challenge('https://laudos.exemplo.test'), /resource_metadata="https:\/\/laudos\.exemplo\.test\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
});

test('MCP is off unless enabled with an https public address', () => {
  assert.equal(chatgptConfig({}).mcp, false);
  assert.equal(chatgptConfig({CHATGPT_MCP_ENABLED: 'true'}).mcp, false);
  assert.match(chatgptConfig({CHATGPT_MCP_ENABLED: 'true'}).mcpProblem, /https/);
  assert.equal(chatgptConfig({CHATGPT_MCP_ENABLED: 'true', PUBLIC_BASE_URL: 'https://laudos.exemplo.test'}).mcp, true);
  assert.equal(chatgptConfig({CHATGPT_TASK_HOURS: '9999'}).taskHours, 168);
});

test('MCP protocol: initialize, list, scoped calls, readable tool errors', async () => {
  const calls = [];
  const ctx = {scopes: [SCOPES.read], version: '1', callTool: async (name, args) => { calls.push(name); if (args.codigo === 'x') throw new ToolError('Tarefa não encontrada'); return {ok: true}; }};
  const init = await handleMessage({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18'}}, ctx);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.match(init.result.instructions.slice(0, 512), /obter_tarefa_pendente[\s\S]*salvar_rascunho/);
  assert.equal(await handleMessage({jsonrpc: '2.0', method: 'notifications/initialized'}, ctx), null);
  const list = await handleMessage({jsonrpc: '2.0', id: 2, method: 'tools/list'}, ctx);
  assert.deepEqual(list.result.tools.map(t => t.name), ['obter_tarefa_pendente', 'salvar_rascunho', 'informar_problema', 'consultar_status_tarefa']);
  assert.ok(list.result.tools.every(t => !('scope' in t) && t.annotations.openWorldHint === false));
  assert.equal(TOOLS.find(t => t.name === 'salvar_rascunho').annotations.readOnlyHint, false);
  // the first version's names still work (a plugin whose tool list was not refreshed)
  const ok = await handleMessage({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'consultar_status_anamnese', arguments: {codigo: 'NL'}}}, ctx);
  assert.deepEqual(ok.result.structuredContent, {ok: true});
  assert.equal(calls.at(-1), 'consultar_status_tarefa');
  // images go as MCP image content, outside the JSON text
  const withImages = await handleMessage({jsonrpc: '2.0', id: 8, method: 'tools/call', params: {name: 'obter_tarefa_pendente', arguments: {}}},
    {...ctx, callTool: async () => ({secao: 'Memória', [IMAGES]: [{mimeType: 'image/png', data: 'iVBORw0KGgo='}]})});
  assert.deepEqual(withImages.result.content.map(c => c.type), ['text', 'image']);
  assert.equal(withImages.result.content[1].mimeType, 'image/png');
  assert.ok(!withImages.result.content[0].text.includes('iVBOR'));
  assert.deepEqual(withImages.result.structuredContent, {secao: 'Memória'});
  const denied = await handleMessage({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'salvar_rascunho_anamnese', arguments: {}}}, ctx);
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /anamnese\.salvar/);
  assert.ok(!calls.includes('salvar_rascunho'), 'a read-only token never reaches the save tool');
  const missing = await handleMessage({jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'consultar_status_anamnese', arguments: {codigo: 'x'}}}, ctx);
  assert.equal(missing.result.isError, true);
  assert.equal((await handleMessage({jsonrpc: '2.0', id: 6, method: 'resources/list'}, ctx)).error.code, -32601);
  assert.equal((await handleMessage({id: 7}, ctx)).error.code, -32600);
});

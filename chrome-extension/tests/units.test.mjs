import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildQueue, nextIndex, progress, summarize} from '../modules/task-queue.js';
import {isTaskCode, checkCommand, reusable, outcome, codeIn} from '../modules/task-validator.js';
import {StateManager, recoverAfterRestart, isActive} from '../modules/state-manager.js';
import {AutoError, describe} from '../modules/error-handler.js';
import {STANDARD, section} from './fakes.mjs';

test('queue: only one eligible section', () => {
  const {items, summary} = buildQueue({sections: [section('a', 'A', 'fixed', 'file'), section('b', 'B')]});
  assert.equal(items.filter(i => i.status === 'pending').length, 1);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.fixed, 1);
});

test('queue: fixed text, hand-written and missing sections are ignored, document order kept', () => {
  const {items} = buildQueue({sections: STANDARD()});
  assert.deepEqual(items.map(i => i.key), STANDARD().map(s => s.key));
  const why = Object.fromEntries(items.map(i => [i.key, i.reason || null]));
  assert.equal(why.fixo_fontes, 'Texto fixo do arquivo');
  assert.equal(why.hipotese, 'Escrita pela psicóloga');
  assert.equal(why.anamnese, 'Já aprovada');
  assert.match(why.memoria, /Já tem texto/);
  assert.deepEqual(items.filter(i => i.status === 'pending').map(i => i.key), ['habilidades_intelectuais', 'percepcao', 'conclusao']);
});

test('queue: existing-text policy "draft" includes sections with text, never approved ones', () => {
  const {items} = buildQueue({sections: STANDARD()}, {existing: 'draft'});
  assert.ok(items.find(i => i.key === 'memoria').status === 'pending');
  assert.equal(items.find(i => i.key === 'anamnese').status, 'skipped');
});

test('queue: selection, unknown kinds and duplicates', () => {
  const {items} = buildQueue({sections: [section('a', 'A'), section('a', 'A again'), section('b', 'B'), {key: 'c', name: 'C', kind: 'weird'}]}, {selected: ['b']});
  assert.equal(items.length, 3);
  assert.equal(items[0].reason, 'Não selecionada');
  assert.equal(items[1].status, 'pending');
  assert.match(items[2].reason, /não identificado/);
});

test('queue: next index and progress', () => {
  const items = [{status: 'received'}, {status: 'skipped'}, {status: 'error'}, {status: 'pending'}, {status: 'pending'}];
  assert.equal(nextIndex(items), 3);
  assert.deepEqual(progress(items), {done: 2, total: 4, pct: 50});
  assert.equal(summarize(items).errors, 1);
});

test('validator: codes and commands', () => {
  assert.ok(isTaskCode('NL-7KQ2-M9XD'));
  assert.ok(!isTaskCode('NL-7KQ2-M9X0'));   // 0 is not in the alphabet
  assert.ok(!isTaskCode('NL-2026-1159'));   // evaluation number, not a task code (contains 0 and 1)
  assert.equal(codeIn('... código NL-7KQ2-M9XD. Ao concluir'), 'NL-7KQ2-M9XD');
  const cmd = 'Utilize o plugin NeuroLaudos IA para buscar a tarefa pendente identificada pelo código NL-7KQ2-M9XD.';
  assert.ok(checkCommand(cmd, 'NL-7KQ2-M9XD').ok);
  assert.match(checkCommand(cmd, 'NL-AAAA-BBBB').reason, /não contém/);
  assert.match(checkCommand(cmd + ' NL-AAAA-BBBB', 'NL-7KQ2-M9XD').reason, /outro código/);
  assert.match(checkCommand('código NL-7KQ2-M9XD', 'NL-7KQ2-M9XD').reason, /plugin/);
  assert.ok(!checkCommand('', 'NL-7KQ2-M9XD').ok);
});

test('validator: reuse only open, unexpired plugin tasks', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const t = {mode: 'mcp', status: 'pending', code: 'NL-7KQ2-M9XD', expires: '2026-11-09T12:00:00Z'};
  assert.ok(reusable(t, now));
  assert.ok(!reusable({...t, expires: '2026-11-08T11:00:00Z'}, now));
  assert.ok(!reusable({...t, mode: 'paste'}, now));
  assert.ok(!reusable({...t, status: 'draft_received'}, now));
});

test('validator: outcome mapping', () => {
  assert.equal(outcome({status: 'draft_received', code: 'X'}, 'X').kind, 'received');
  assert.equal(outcome({status: 'draft_received', needsConfirmation: true, code: 'X'}, 'X').kind, 'needs_review');
  assert.equal(outcome({status: 'reviewed', code: 'X'}, 'X').kind, 'received');
  assert.equal(outcome({status: 'processing', code: 'X'}, 'X').kind, 'waiting');
  assert.equal(outcome({status: 'expired', code: 'X'}, 'X').kind, 'expired');
  assert.equal(outcome({status: 'error', code: 'X'}, 'X').kind, 'failed');
  assert.equal(outcome({status: 'pending', code: 'Y'}, 'X').kind, 'other');
});

test('state: serialized updates, log cap, restart recovery', async () => {
  const m = new Map();
  const st = new StateManager({get: async k => m.get(k), set: async (k, v) => m.set(k, v), remove: async k => m.delete(k)});
  await st.create({evaluationId: 'e', nlTabId: 1, mode: 'auto', policy: {}, items: [{key: 'a', status: 'pending'}, {key: 'b', status: 'pending'}]});
  await Promise.all([st.setItem(0, {code: 'NL-AAAA-BBBB'}), st.setItem(1, {code: 'NL-CCCC-DDDD'})]);
  const s = await st.load();
  assert.equal(s.items[0].code, 'NL-AAAA-BBBB');
  assert.equal(s.items[1].code, 'NL-CCCC-DDDD');
  for (let i = 0; i < 200; i++) await st.log('x' + i);
  assert.equal((await st.load()).log.length, 150);
  await st.setItem(0, {sentAt: '2026-11-08T12:00:00Z', step: 'wait_chatgpt', status: 'processing'});
  const r = recoverAfterRestart(await st.load());
  assert.equal(r.status, 'paused');
  assert.equal(r.items[0].step, 'confirm');
  assert.ok(!r.items[1].step);
  assert.ok(isActive(r));
  await st.clear();
  assert.equal(await st.load(), null);
});

test('errors: Portuguese message, step and hint', () => {
  const d = describe(new AutoError('cg_plugin_missing', 'plugin'));
  assert.match(d.message, /plugin NeuroLaudos IA/);
  assert.equal(d.stepLabel, 'Selecionar o plugin NeuroLaudos IA');
  assert.ok(d.hint);
  assert.equal(describe(new Error('Could not establish connection. Receiving end does not exist.')).code, 'connection');
});

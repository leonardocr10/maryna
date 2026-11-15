// Batch of evaluations (several chosen in the list, run one after another) against synthetic pages.
// Every evaluation, section and code here is made up; the same section keys repeat on purpose in each evaluation,
// so a mix-up between patients would show as a code or a draft on the wrong evaluation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv, section, NL_TAB} from './fakes.mjs';
import {batchQueue, conclusionUnfinished} from '../modules/task-queue.js';
import {batchTotals} from '../modules/automation-manager.js';
import {recoverAfterRestart} from '../modules/state-manager.js';
import {BATCH_MAX} from '../modules/constants.js';

const EV = ['ev-sint-aaaa1', 'ev-sint-bbbb2', 'ev-sint-cccc3'];
const READY = 'Integrar atenção e memória; relatar no final que apresenta características de desenvolvimento típico (texto sintético).';
const secs = () => [section('demanda', 'Descrição da demanda'), section('fixo_fontes', 'Fontes fundamentais de informações', 'fixed', 'file'), section('atencao', 'Atenção'), section('memoria', 'Memória e aprendizagem'), section('hipotese', 'Hipótese diagnóstica', 'hand'), section('conclusao', 'Conclusão'), section('recomendacoes', 'Indicações e recomendações')];
const three = (extra = {}) => Object.fromEntries(EV.map(id => [id, {sections: secs(), instruction: READY, ...(extra[id] || {})}]));
const batch = (t, extra = {}) => t.mgr.startBatch({nlTabId: NL_TAB, nlOrigin: 'http://localhost:9091', mode: 'auto', policy: {existing: 'draft', onError: 'pause', sendImages: false, sameChat: true}, ids: EV, ...extra});
const finish = async t => { await t.mgr.task; return t.env.state.load(); };
const cmds = (t, c) => t.calls.filter(x => x.cmd === c);

/** Every page action of a section ran while the tab showed that same evaluation; one sent while another patient was
 *  shown was refused by the page (nl_changed), never answered. */
function assertPageIsolation(t) {
  for (const c of t.calls.filter(x => x.tabId === NL_TAB && x.key)) assert.ok(c.refused ? c.shown !== c.evaluationId : c.shown === c.evaluationId, `${c.cmd} ${c.key} ran on the evaluation it was meant for`);
}
/** Every draft the server saved went to the evaluation and section where its task code was prepared. */
function assertDraftsAtOrigin(t) {
  for (const sv of t.saves) assert.ok(t.prepared.some(p => p.code === sv.code && p.evaluationId === sv.evaluationId && p.key === sv.key), `draft ${sv.code} on its own evaluation`);
}

test('batch: evaluations run one after another, each section with its own code, draft saved on its own evaluation', async () => {
  const t = makeEnv({evals: three()});
  await batch(t);
  const s = await finish(t);
  assert.equal(s.status, 'done');
  assert.deepEqual(s.batch.list.map(e => e.status), ['done', 'done', 'done']);
  // 3 per evaluation: atenção, memória, conclusão, recomendações (demanda off by default)
  assert.deepEqual(s.batch.list.map(e => e.summary.received), [4, 4, 4]);
  const sends = cmds(t, 'cg.send');
  assert.equal(sends.length, 12);
  assert.equal(new Set(sends.map(c => c.code)).size, 12, 'never the same code twice, even with the same section keys');
  // Strictly in sequence: every message of evaluation 1 before any of evaluation 2, and so on
  const owner = code => EV.find(id => Object.values(t.evals[id].tasks).some(x => x.code === code));
  assert.deepEqual(sends.map(c => owner(c.code)), EV.flatMap(id => Array(4).fill(id)));
  // The server saved each draft on the evaluation of its task (where it was prepared), and the section matches
  assert.equal(t.saves.length, 12);
  assertDraftsAtOrigin(t);
  // Each message went while the run was on that evaluation, and the command inserted carried that same code
  for (const c of cmds(t, 'cg.insert')) assert.ok(c.text.includes(c.code));
  assertPageIsolation(t);
  assert.ok(!t.calls.some(c => c.refused), 'nothing was refused: the tab always showed the right evaluation');
  assert.ok(!t.calls.some(c => c.key === 'hipotese'), 'never the diagnosis');
  assert.ok(!t.calls.some(c => c.key === 'demanda'), 'Descrição da demanda stays out unless chosen');
});

test('batch: a new ChatGPT conversation and plugin mention for every section, never one conversation across patients', async () => {
  const t = makeEnv({evals: three()});
  await batch(t);
  await finish(t);
  assert.equal(t.opened.length, 12, 'new conversation per section');
  assert.equal(cmds(t, 'cg.selectPlugin').length, 12);
  assert.ok(cmds(t, 'cg.ping').filter(c => c.fresh).length >= 12);
});

test('batch: the tab moved to another patient while ChatGPT wrote: the draft lands on the origin, the run goes back to it', async () => {
  let moved = false;
  const t = makeEnv({evals: three(), cg: {onWait: (nl, show) => { if (!moved && nl.evaluationId === EV[0]) { moved = true; show(EV[2]); } }}});
  await batch(t);
  const s = await finish(t);
  assert.ok(moved);
  assert.equal(s.status, 'done');
  const first = t.saves[0];
  assert.equal(first.evaluationId, EV[0], 'draft saved on the evaluation of its task');
  assert.equal(t.evals[EV[0]].tasks.atencao.status, 'draft_received');
  assert.ok(s.log.some(l => /voltando para a avaliação do lote/.test(l.msg)));
  assert.ok(t.calls.some(c => c.refused && c.shown === EV[2] && c.evaluationId === EV[0]), 'the page refused to answer for another patient');
  // Evaluation 3 was only shown, nothing of it was prepared before its turn
  const prepC = cmds(t, 'nl.prepare').filter(c => c.evaluationId === EV[2]);
  const firstSendOf3 = cmds(t, 'cg.send').findIndex(c => Object.values(t.evals[EV[2]].tasks).some(x => x.code === c.code));
  assert.ok(prepC.length === 4 && firstSendOf3 >= 8);
  assertDraftsAtOrigin(t);
  assertPageIsolation(t);
});

test('batch: an evaluation that does not open (or is read-only) is recorded and the batch goes on', async () => {
  const t = makeEnv({evals: three({[EV[0]]: {openFails: true}, [EV[1]]: {readOnly: true}})});
  await batch(t);
  const s = await finish(t);
  assert.deepEqual(s.batch.list.map(e => e.status), ['error', 'error', 'done']);
  assert.ok(s.batch.list[0].error);
  assert.equal(cmds(t, 'cg.send').length, 4);
  assert.ok(t.saves.every(sv => sv.evaluationId === EV[2]));
  assert.equal(batchTotals(s).failed, 2);
});

test('batch: Conclusão only with its instruction completed; Recomendações wait for a Conclusão text', async () => {
  const t = makeEnv({evals: three({[EV[1]]: {instruction: 'Integrar os resultados; relatar no final que apresenta características '}})});
  await batch(t);
  const s = await finish(t);
  const sentKeys = id => t.saves.filter(x => x.evaluationId === id).map(x => x.key);
  assert.deepEqual(sentKeys(EV[1]), ['atencao', 'memoria']);
  assert.deepEqual(sentKeys(EV[0]), ['atencao', 'memoria', 'conclusao', 'recomendacoes']);
  assert.equal(s.batch.list[1].summary.received, 2);
});

test('batch queue (pure): options, dependencies and the evaluation id on every item', () => {
  const scan = {sections: secs()};
  let items = batchQueue(scan, {existing: 'draft', conclusionReady: false, evaluationId: 'ev-x-00001'});
  const st = k => items.find(i => i.key === k);
  assert.equal(st('demanda').status, 'skipped');
  assert.equal(st('conclusao').status, 'skipped');
  assert.equal(st('recomendacoes').status, 'skipped');
  assert.equal(st('atencao').status, 'pending');
  assert.ok(items.every(i => i.evaluationId === 'ev-x-00001'));
  items = batchQueue({sections: secs().map(x => x.key === 'conclusao' ? {...x, state: 'gen'} : x)}, {existing: 'draft', includeDemand: true});
  assert.equal(st('demanda').status, 'pending');
  assert.equal(st('recomendacoes').status, 'pending', 'a Conclusão with text is enough for the recommendations');
  assert.ok(conclusionUnfinished('relatar que apresenta características ') && conclusionUnfinished('') && !conclusionUnfinished(READY));
});

test('batch: limits — 1 to 10 different evaluations, valid ids, one run at a time', async () => {
  const t = makeEnv({evals: three()});
  const ids = n => Array.from({length: n}, (_, i) => 'ev-sint-' + String(i).padStart(5, '0'));
  await assert.rejects(batch(t, {ids: ids(BATCH_MAX + 1)}), /1 a 10/);
  await assert.rejects(batch(t, {ids: []}), /1 a 10/);
  await assert.rejects(batch(t, {ids: [EV[0], EV[0]]}), /1 a 10/);
  await assert.rejects(batch(t, {ids: ['<script>']}), /1 a 10/);
  await batch(t);
  await assert.rejects(batch(t), e => e.code === 'busy');
  await finish(t);
});

test('batch: pause and continue keep the evaluation; stop then "continuar" finishes the rest of the queue', async () => {
  let paused = false;
  const t = makeEnv({evals: three(), cg: {onWait: nl => { if (!paused && nl.evaluationId === EV[1]) { paused = true; t.mgr.pause(); } }}});
  await batch(t);
  let s = await finish(t);
  assert.equal(s.status, 'paused');
  assert.equal(s.evaluationId, EV[1]);
  await t.mgr.stop();
  s = await t.env.state.load();
  assert.equal(s.status, 'stopped');
  await t.mgr.continueRun();
  s = await finish(t);
  assert.equal(s.status, 'done');
  assert.deepEqual(s.batch.list.map(e => e.status), ['done', 'done', 'done']);
  assert.equal(new Set(cmds(t, 'cg.send').map(c => c.code)).size, cmds(t, 'cg.send').length, 'nothing sent twice');
  assertDraftsAtOrigin(t);
  assertPageIsolation(t);
});

test('batch: a section that stops the run can skip the whole evaluation; the next one runs', async () => {
  const t = makeEnv({evals: three(), nl: {draftOutcome: (key, ev) => ev === EV[0] && key === 'atencao' ? 'problem' : 'received'}});
  await batch(t);
  let s = await finish(t);
  assert.equal(s.status, 'paused');
  assert.ok(s.pause.actions.includes('skip_eval'));
  await t.mgr.resume('skip_eval');
  s = await finish(t);
  assert.equal(s.status, 'done');
  assert.deepEqual(s.batch.list.map(e => e.status), ['skipped', 'done', 'done']);
  assert.ok(!t.saves.some(x => x.evaluationId === EV[0]));
});

test('batch: a gentle pace between two messages to ChatGPT', async () => {
  const t = makeEnv({evals: three(), settings: {batchGapSeconds: 30}});
  await batch(t);
  await finish(t);
  const at = cmds(t, 'cg.send').map(c => c.at);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 30000, `gap ${i}`);
});

test('batch: browser restart after a send resumes paused on the same evaluation, checks before anything else', async () => {
  let cut = false;
  const t = makeEnv({evals: three(), cg: {onWait: nl => { if (!cut && nl.evaluationId === EV[1]) { cut = true; t.mgr.pause(); } }}});
  await batch(t);
  await finish(t);
  await t.env.state.update(cur => recoverAfterRestart({...cur, status: 'running'}));
  let s = await t.env.state.load();
  assert.equal(s.evaluationId, EV[1]);
  const sentBefore = cmds(t, 'cg.send').length;
  await t.mgr.resume('continue');
  s = await finish(t);
  assert.equal(s.status, 'done');
  assert.equal(cmds(t, 'cg.send').length, sentBefore + 3 + 4, 'the interrupted section is checked, not sent again');
});
